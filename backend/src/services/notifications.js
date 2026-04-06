const nodemailer = require("nodemailer");

async function sendReportNotifications(database, user, report) {
  const results = [];

  if (user.emailEnabled && user.reportEmail) {
    results.push(await sendEmailReport(database, user, report));
  }

  if (user.whatsappEnabled && user.whatsappNumber) {
    results.push(await sendWhatsAppReport(database, user, report));
  }

  if (!results.length) {
    const simulated = recordNotification(database, user.id, report.id, {
      channel: "simulation",
      status: "logged",
      message: `No delivery channel configured for ${user.displayName}. Report ${report.id} saved locally.`,
    });
    return [simulated];
  }

  return results;
}

async function sendEmailReport(database, user, report) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_FROM } = process.env;

  if (!SMTP_HOST || !SMTP_PORT || !SMTP_USER || !SMTP_PASS || !SMTP_FROM) {
    return recordNotification(database, user.id, report.id, {
      channel: "email",
      status: "simulated",
      message: `Email report ready for ${user.reportEmail}. Add SMTP env vars to send for real.`,
    });
  }

  const transporter = nodemailer.createTransport({
    host: SMTP_HOST,
    port: Number(SMTP_PORT),
    secure: Number(SMTP_PORT) === 465,
    auth: { user: SMTP_USER, pass: SMTP_PASS },
  });

  await transporter.sendMail({
    from: SMTP_FROM,
    to: user.reportEmail,
    subject: `${capitalize(report.type)} expense report`,
    text: report.message,
  });

  return recordNotification(database, user.id, report.id, {
    channel: "email",
    status: "sent",
    message: `Email report sent to ${user.reportEmail}.`,
  });
}

async function sendWhatsAppReport(database, user, report) {
  return recordNotification(database, user.id, report.id, {
    channel: "whatsapp",
    status: "simulated",
    message: `WhatsApp report prepared for ${user.whatsappNumber}. Plug in a provider like Twilio to deliver for real.`,
  });
}

function recordNotification(database, userId, reportId, entry) {
  const notification = {
    ...entry,
    userId,
    reportId,
    createdAt: new Date().toISOString(),
  };
  database.reports.notifications.unshift(notification);
  return notification;
}

function capitalize(value) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

module.exports = {
  sendReportNotifications,
};
