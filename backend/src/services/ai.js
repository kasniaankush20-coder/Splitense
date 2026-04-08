const { buildExpenseInsights, listExpensesForCategory } = require("./analytics");
const { endOfMonth, generateId, getDateOnly, startOfMonth } = require("./utils");

const MAX_CONVERSATION_MESSAGES = 12;
const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

async function getConversation(database, user, sessionId = "default") {
  if (!database.ai) {
    database.ai = { conversations: [] };
  }

  let conversation = database.ai.conversations.find(
    (item) => item.userId === user.id && item.sessionId === sessionId
  );

  if (!conversation) {
    conversation = {
      id: generateId("conversation"),
      userId: user.id,
      sessionId,
      messages: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    database.ai.conversations.unshift(conversation);
  }

  return conversation;
}

async function getConversationState(database, user, sessionId = "default") {
  const conversation = await getConversation(database, user, sessionId);
  return {
    id: conversation.id,
    sessionId: conversation.sessionId,
    messages: conversation.messages || [],
    updatedAt: conversation.updatedAt,
  };
}

async function answerExpenseQuestion(database, user, payload = {}) {
  const message = String(payload.message || "").trim();
  const sessionId = String(payload.sessionId || "default").trim() || "default";

  if (!message) {
    return {
      reply: "Ask about your expenses, spending trends, categories, or balances and I’ll dig into your Splitense data.",
      intent: "empty",
      usedModel: false,
      sessionId,
    };
  }

  const conversation = await getConversation(database, user, sessionId);
  const insights = buildExpenseInsights(database, user, getDateOnly());
  const structuredIntent = inferIntent(message, insights);

  let reply;
  let usedModel = false;

  if (structuredIntent.intent === "generic") {
    const llmReply = await requestOpenAiAnswer({ user, message, insights, conversation });
    if (llmReply) {
      reply = llmReply;
      usedModel = true;
    } else {
      reply = buildFallbackReply(message, insights, conversation);
    }
  } else {
    reply = buildIntentReply(structuredIntent, insights);
  }

  appendConversationMessage(conversation, "user", message);
  appendConversationMessage(conversation, "assistant", reply);

  return {
    reply,
    intent: structuredIntent.intent,
    usedModel,
    sessionId,
    conversation: {
      id: conversation.id,
      messages: conversation.messages,
      updatedAt: conversation.updatedAt,
    },
  };
}

function inferIntent(message, insights) {
  const normalized = normalizeText(message);
  const category = findCategoryMention(normalized, Object.keys(insights.categories.totals));

  if (category && /(show|list|display|find)/.test(normalized) && /(expense|expenses|spend|spent)/.test(normalized)) {
    return { intent: "category_expenses", category };
  }

  if (/(last month|previous month)/.test(normalized) && /(how much|spent|spend|total)/.test(normalized)) {
    return { intent: "last_month_total" };
  }

  if (/(this month|current month)/.test(normalized) && /(how much|spent|spend|total)/.test(normalized)) {
    return { intent: "this_month_total" };
  }

  if (/(this week|current week)/.test(normalized) && /(how much|spent|spend|total)/.test(normalized)) {
    return { intent: "this_week_total" };
  }

  if (/(who owes me the most|top debtor|owes me most)/.test(normalized)) {
    return { intent: "top_debtor" };
  }

  if (/(what do i owe|who do i owe|owe the most)/.test(normalized)) {
    return { intent: "top_creditor" };
  }

  if (/(highest spending category|top category|highest category)/.test(normalized)) {
    return { intent: "highest_category" };
  }

  if (category && /(how much|spent|spend|total)/.test(normalized)) {
    return { intent: "category_total", category };
  }

  if (/(summary|overview|insight|insights)/.test(normalized)) {
    return { intent: "summary" };
  }

  return { intent: "generic" };
}

function buildIntentReply(intent, insights) {
  if (intent.intent === "category_expenses") {
    const matchingExpenses = listExpensesForCategory(insights, intent.category);
    if (!matchingExpenses.length) {
      return `I couldn’t find any ${intent.category} expenses yet.`;
    }

    const total = matchingExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
    const preview = matchingExpenses
      .slice(0, 5)
      .map((expense) => `${expense.title} on ${expense.date} for INR ${Number(expense.amount || 0).toFixed(2)}`)
      .join("; ");

    return `You have ${matchingExpenses.length} ${intent.category} expense${matchingExpenses.length === 1 ? "" : "s"} totaling INR ${total.toFixed(2)}. Recent ones: ${preview}.`;
  }

  if (intent.intent === "category_total") {
    const amount = Number(insights.categories.totals[intent.category] || 0);
    return `You’ve spent INR ${amount.toFixed(2)} on ${intent.category}.`;
  }

  if (intent.intent === "last_month_total") {
    return `Last month you spent INR ${Number(insights.totals.lastMonth || 0).toFixed(2)} between ${insights.periods.lastMonth.rangeStart} and ${insights.periods.lastMonth.rangeEnd}.`;
  }

  if (intent.intent === "this_month_total") {
    return `This month you’ve spent INR ${Number(insights.totals.thisMonth || 0).toFixed(2)} so far.`;
  }

  if (intent.intent === "this_week_total") {
    return `This week you’ve spent INR ${Number(insights.totals.thisWeek || 0).toFixed(2)} so far.`;
  }

  if (intent.intent === "top_debtor") {
    const debtor = insights.owedSummary.topDebtor;
    return debtor
      ? `${debtor.displayName} owes you the most right now: INR ${Number(debtor.netAmount || 0).toFixed(2)}.`
      : "Nobody owes you money right now based on your shared expenses.";
  }

  if (intent.intent === "top_creditor") {
    const creditor = insights.owedSummary.topCreditor;
    return creditor
      ? `You owe ${creditor.displayName} the most right now: INR ${Math.abs(Number(creditor.netAmount || 0)).toFixed(2)}.`
      : "You don’t currently owe anyone based on your shared expenses.";
  }

  if (intent.intent === "highest_category") {
    return insights.categories.highest
      ? `Your highest spending category is ${insights.categories.highest.category} at INR ${Number(insights.categories.highest.amount || 0).toFixed(2)}.`
      : "You don’t have enough expense data yet to identify a highest category.";
  }

  return buildFallbackReply("", insights);
}

function buildFallbackReply(message, insights, conversation = { messages: [] }) {
  const topCategory = insights.categories.highest
    ? `${insights.categories.highest.category} (INR ${Number(insights.categories.highest.amount || 0).toFixed(2)})`
    : "no clear category yet";
  const priorReference = conversation.messages.length
    ? " I also kept the recent chat context in mind."
    : "";

  return `Here’s the quick picture: this month you’ve spent INR ${Number(insights.totals.thisMonth || 0).toFixed(2)}, last month you spent INR ${Number(insights.totals.lastMonth || 0).toFixed(2)}, and your top category is ${topCategory}.${priorReference}`;
}

async function requestOpenAiAnswer({ user, message, insights, conversation }) {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }

  const recentContext = (conversation.messages || [])
    .slice(-6)
    .map((item) => `${item.role}: ${item.content}`)
    .join("\n");
  const compactInsights = buildCompactInsights(insights);

  try {
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        temperature: 0.2,
        max_output_tokens: 220,
        input: [
          {
            role: "system",
            content: [
              {
                type: "input_text",
                text: "You are Splitense AI. Answer only using the supplied expense data. Be concise, practical, and human. If the data is insufficient, say so clearly. Never invent records.",
              },
            ],
          },
          {
            role: "user",
            content: [
              {
                type: "input_text",
                text: [
                  `User: ${user.displayName}`,
                  `Today: ${getDateOnly()}`,
                  `Conversation context: ${recentContext || "none"}`,
                  `Expense insights: ${JSON.stringify(compactInsights)}`,
                  `Question: ${message}`,
                ].join("\n"),
              },
            ],
          },
        ],
      }),
    });

    if (!response.ok) {
      console.warn("OpenAI request failed", response.status);
      return null;
    }

    const payload = await response.json();
    const text = payload.output_text || extractResponseText(payload);
    return String(text || "").trim() || null;
  } catch (error) {
    console.warn("OpenAI request error", error);
    return null;
  }
}

function buildCompactInsights(insights) {
  return {
    totals: insights.totals,
    categories: insights.categories,
    owedSummary: {
      topDebtor: insights.owedSummary.topDebtor,
      topCreditor: insights.owedSummary.topCreditor,
      people: insights.owedSummary.people.slice(0, 6),
    },
    recentExpenses: insights.recentExpenses.slice(0, 8).map((expense) => ({
      title: expense.title,
      amount: expense.amount,
      category: expense.category,
      date: expense.date,
      type: expense.type,
    })),
    monthlyWindow: {
      rangeStart: startOfMonth(getDateOnly()),
      rangeEnd: endOfMonth(getDateOnly()),
    },
  };
}

function appendConversationMessage(conversation, role, content) {
  if (!Array.isArray(conversation.messages)) {
    conversation.messages = [];
  }

  conversation.messages.push({
    id: generateId("message"),
    role,
    content,
    createdAt: new Date().toISOString(),
  });
  conversation.messages = conversation.messages.slice(-MAX_CONVERSATION_MESSAGES);
  conversation.updatedAt = new Date().toISOString();
}

function findCategoryMention(message, availableCategories) {
  const categories = availableCategories.length ? availableCategories : ["Food", "Travel", "Shopping", "Bills", "Entertainment", "Health", "Education", "Other"];
  return categories.find((category) => message.includes(category.toLowerCase())) || null;
}

function extractResponseText(payload) {
  return (payload.output || [])
    .flatMap((item) => item.content || [])
    .map((item) => item.text || "")
    .join(" ");
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

module.exports = {
  answerExpenseQuestion,
  getConversationState,
};
