const nodemailer = require("nodemailer");

async function sendReportNotifications(database, user, report) {
  const results = [];

  if (user.whatsappEnabled && user.whatsappNumber) {
    results.push(await sendWhatsAppReport(database, user, report));
  }

  if (!results.length) {
    const simulated = recordNotification(database, user.id, report.id, {
      channel: "simulation",
      provider: "local",
      status: "logged",
      message: `No delivery channel configured for ${user.displayName}. Report ${report.id} saved locally.`,
    });
    return [simulated];
  }

  user.lastCommunicationAt = new Date().toISOString();
  return results;
}

async function sendEmailReport(database, user, report) {
  const transporterConfig = buildEmailTransport();

  if (!transporterConfig) {
    return recordNotification(database, user.id, report.id, {
      channel: "email",
      provider: "simulation",
      status: "simulated",
      message: `Email report ready for ${user.reportEmail}. Configure SMTP or Gmail OAuth to send for real.`,
    });
  }

  const transporter = nodemailer.createTransport(transporterConfig.transport);
  const message = buildEmailMessage(user, report, transporterConfig.from);

  try {
    const info = await retry(async () => transporter.sendMail(message), 2);
    return recordNotification(database, user.id, report.id, {
      channel: "email",
      provider: transporterConfig.provider,
      status: "sent",
      providerMessageId: info.messageId,
      message: `Email report sent to ${user.reportEmail}.`,
    });
  } catch (error) {
    console.error("Email report delivery failed", error);
    return recordNotification(database, user.id, report.id, {
      channel: "email",
      provider: transporterConfig.provider,
      status: "failed",
      message: `Email delivery failed: ${error.message}`,
    });
  }
}

async function sendWhatsAppReport(database, user, report) {
  const to = normalizeWhatsAppNumber(user.whatsappNumber);
  const providerConfig = buildWhatsAppConfig();

  if (!to) {
    return recordNotification(database, user.id, report.id, {
      channel: "whatsapp",
      provider: "validation",
      status: "failed",
      message: "WhatsApp number must be in international format like +919876543210.",
    });
  }

  if (!providerConfig) {
    return recordNotification(database, user.id, report.id, {
      channel: "whatsapp",
      provider: "simulation",
      status: "simulated",
      message: `WhatsApp report prepared for ${to}. Add Twilio credentials to deliver for real.`,
    });
  }

  const statusCallback = process.env.TWILIO_STATUS_CALLBACK_URL || "";
  const body = new URLSearchParams({
    To: `whatsapp:${to}`,
    From: providerConfig.from,
    Body: buildWhatsAppMessage(report),
  });

  if (statusCallback) {
    body.set("StatusCallback", statusCallback);
  }

  try {
    const response = await retry(
      () => fetch(providerConfig.url, {
        method: "POST",
        headers: {
          Authorization: `Basic ${Buffer.from(`${providerConfig.accountSid}:${providerConfig.authToken}`).toString("base64")}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      }),
      2
    );

    if (!response.ok) {
      throw new Error(`Twilio responded with ${response.status}`);
    }

    const payload = await response.json();
    return recordNotification(database, user.id, report.id, {
      channel: "whatsapp",
      provider: "twilio",
      status: payload.status || "queued",
      providerMessageId: payload.sid,
      message: `WhatsApp report queued for ${to}.`,
    });
  } catch (error) {
    console.error("WhatsApp report delivery failed", error);
    return recordNotification(database, user.id, report.id, {
      channel: "whatsapp",
      provider: "twilio",
      status: "failed",
      message: `WhatsApp delivery failed: ${error.message}`,
    });
  }
}

function updateWhatsAppDeliveryStatus(database, payload = {}) {
  const messageId = String(payload.MessageSid || payload.SmsSid || "").trim();
  if (!messageId) {
    return null;
  }

  const notification = database.reports.notifications.find((entry) => entry.providerMessageId === messageId);
  if (!notification) {
    return null;
  }

  notification.status = payload.MessageStatus || payload.SmsStatus || notification.status;
  notification.deliveryUpdatedAt = new Date().toISOString();
  notification.providerPayload = {
    messageSid: messageId,
    messageStatus: payload.MessageStatus || payload.SmsStatus || "",
    to: payload.To || "",
    from: payload.From || "",
  };

  return notification;
}

function getNotificationHistory(database, user, limit = 20) {
  return (database.reports?.notifications || [])
    .filter((entry) => entry.userId === user.id)
    .slice(0, limit);
}

function recordNotification(database, userId, reportId, entry) {
  const notification = {
    ...entry,
    id: `${userId}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    userId,
    reportId,
    createdAt: new Date().toISOString(),
  };
  database.reports.notifications.unshift(notification);
  return notification;
}

function buildEmailTransport() {
  const gmailClientId = process.env.GMAIL_CLIENT_ID;
  const gmailClientSecret = process.env.GMAIL_CLIENT_SECRET;
  const gmailRefreshToken = process.env.GMAIL_REFRESH_TOKEN;
  const gmailUser = process.env.GMAIL_USER;

  if (
    isUsableSecret(gmailClientId) &&
    isUsableSecret(gmailClientSecret) &&
    isUsableSecret(gmailRefreshToken) &&
    isUsableSecret(gmailUser)
  ) {
    return {
      provider: "gmail_oauth2",
      from: process.env.SMTP_FROM || gmailUser,
      transport: {
        service: "gmail",
        auth: {
          type: "OAuth2",
          user: gmailUser,
          clientId: gmailClientId,
          clientSecret: gmailClientSecret,
          refreshToken: gmailRefreshToken,
        },
      },
    };
  }

  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;
  if (isGmailAddress(SMTP_USER) && SMTP_PASS && (isPlaceholderHost(SMTP_HOST) || !SMTP_HOST)) {
    return {
      provider: "gmail_smtp",
      from: SMTP_FROM || SMTP_USER,
      transport: {
        service: "gmail",
        auth: {
          user: SMTP_USER,
          pass: SMTP_PASS,
        },
      },
    };
  }

  if (SMTP_HOST && SMTP_PORT && SMTP_USER && SMTP_PASS && SMTP_FROM) {
    return {
      provider: "smtp",
      from: SMTP_FROM,
      transport: {
        host: SMTP_HOST,
        port: Number(SMTP_PORT),
        secure: Number(SMTP_PORT) === 465,
        auth: { user: SMTP_USER, pass: SMTP_PASS },
      },
    };
  }

  return null;
}

function isUsableSecret(value) {
  const text = String(value || "").trim();
  if (!text) {
    return false;
  }

  return ![
    "yourgmail@gmail.com",
    "your-google-client-id",
    "your-google-client-secret",
    "your-google-refresh-token",
  ].includes(text);
}

function isPlaceholderHost(value) {
  const text = String(value || "").trim().toLowerCase();
  return !text || text === "smtp.example.com" || text === "example.com";
}

function isGmailAddress(value) {
  return /@gmail\.com$/i.test(String(value || "").trim());
}

function buildEmailMessage(user, report, from) {
  const html = buildReportHtml(user, report);
  return {
    from,
    to: user.reportEmail,
    subject: `${capitalize(report.type)} Splitense report`,
    text: [report.message, "", buildCategorySummary(report.categoryTotals)].join("\n"),
    html,
  };
}

function buildReportHtml(user, report) {
  const rows = Object.entries(report.categoryTotals || {})
    .sort((left, right) => right[1] - left[1])
    .map(
      ([category, total]) => `<tr><td style="padding:8px 0;color:#5b5248;">${escapeHtml(category)}</td><td style="padding:8px 0;text-align:right;font-weight:700;color:#1f1d1a;">INR ${Number(total).toFixed(2)}</td></tr>`
    )
    .join("");

  return `
    <div style="font-family:Arial,sans-serif;background:#f7f2ea;padding:24px;color:#1f1d1a;">
      <div style="max-width:620px;margin:0 auto;background:#fff;border-radius:18px;padding:24px;border:1px solid #eadfd1;">
        <p style="margin:0 0 8px;color:#7b6e61;font-size:12px;letter-spacing:0.08em;text-transform:uppercase;">Splitense report</p>
        <h1 style="margin:0 0 10px;font-size:28px;">${capitalize(report.type)} summary for ${escapeHtml(user.displayName)}</h1>
        <p style="margin:0 0 18px;color:#5b5248;">${escapeHtml(report.rangeStart)} to ${escapeHtml(report.rangeEnd)}</p>
        <div style="padding:18px;border-radius:16px;background:#eef8f4;border:1px solid #d2e7de;margin-bottom:20px;">
          <strong style="display:block;font-size:14px;color:#235f51;margin-bottom:6px;">Total spent</strong>
          <div style="font-size:30px;font-weight:800;">INR ${Number(report.totalSpent || 0).toFixed(2)}</div>
        </div>
        <table style="width:100%;border-collapse:collapse;">
          <thead>
            <tr>
              <th style="text-align:left;padding-bottom:8px;border-bottom:1px solid #eadfd1;">Category</th>
              <th style="text-align:right;padding-bottom:8px;border-bottom:1px solid #eadfd1;">Amount</th>
            </tr>
          </thead>
          <tbody>${rows || '<tr><td colspan="2" style="padding-top:14px;color:#7b6e61;">No expense data for this period.</td></tr>'}</tbody>
        </table>
        <p style="margin:20px 0 0;color:#5b5248;line-height:1.6;">${escapeHtml(report.message)}</p>
      </div>
    </div>
  `;
}

function buildCategorySummary(categoryTotals = {}) {
  const entries = Object.entries(categoryTotals).sort((left, right) => right[1] - left[1]);
  if (!entries.length) {
    return "No category breakdown available.";
  }

  return `Category breakdown: ${entries.map(([category, total]) => `${category} INR ${Number(total).toFixed(2)}`).join(", ")}`;
}

function buildWhatsAppConfig() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_WHATSAPP_FROM;

  if (!accountSid || !authToken || !from) {
    return null;
  }

  return {
    accountSid,
    authToken,
    from: from.startsWith("whatsapp:") ? from : `whatsapp:${from}`,
    url: `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
  };
}

function buildWhatsAppMessage(report) {
  const highestCategory = report.highestCategory
    ? `${report.highestCategory[0]} (INR ${Number(report.highestCategory[1] || 0).toFixed(2)})`
    : buildTopCategoryFromTotals(report.categoryTotals);

  return [
    `Splitense ${capitalize(report.type)} report`,
    `${report.rangeStart} to ${report.rangeEnd}`,
    `Total spent: INR ${Number(report.totalSpent || 0).toFixed(2)}`,
    `Top category: ${highestCategory || "No category data"}`,
  ].join("\n");
}

function buildTopCategoryFromTotals(categoryTotals = {}) {
  const topEntry = Object.entries(categoryTotals).sort((left, right) => right[1] - left[1])[0];
  return topEntry ? `${topEntry[0]} (INR ${Number(topEntry[1] || 0).toFixed(2)})` : "";
}

async function retry(action, attempts) {
  let lastError = null;

  for (let attempt = 0; attempt <= attempts; attempt += 1) {
    try {
      return await action();
    } catch (error) {
      lastError = error;
      await delay((attempt + 1) * 250);
    }
  }

  throw lastError;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeWhatsAppNumber(value) {
  const digits = String(value || "").replace(/[^\d+]/g, "");
  if (!digits.startsWith("+") || digits.length < 10) {
    return null;
  }
  return digits;
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

module.exports = {
  getNotificationHistory,
  sendReportNotifications,
  updateWhatsAppDeliveryStatus,
};
