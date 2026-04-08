const { buildExpenseInsights, listExpensesForCategory } = require("./analytics");
const { endOfMonth, generateId, getDateOnly, startOfMonth } = require("./utils");

const MAX_CONVERSATION_MESSAGES = 12;
const DEFAULT_MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";
const DEFAULT_CATEGORIES = ["Food", "Travel", "Shopping", "Bills", "Entertainment", "Health", "Education", "Other"];

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
      reply: "Ask about your expenses, trends, balances, categories, or recent activity and I'll look through your Splitense data.",
      intent: "empty",
      usedModel: false,
      sessionId,
    };
  }

  const conversation = await getConversation(database, user, sessionId);
  const insights = buildExpenseInsights(database, user, getDateOnly());
  const structuredIntent = inferIntent(message, insights, conversation);

  let reply;
  let usedModel = false;

  if (structuredIntent.intent === "generic") {
    const llmReply = await requestOpenAiAnswer({ user, message, insights, conversation });
    if (llmReply) {
      reply = llmReply;
      usedModel = true;
    } else {
      reply = buildSmartFallbackReply(message, insights, conversation);
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

function inferIntent(message, insights, conversation = { messages: [] }) {
  const normalized = normalizeText(message);
  const category = findCategoryMention(normalized, Object.keys(insights.categories.totals));
  const hasExpenseWords = /(expense|expenses|spend|spent|spending|payment|payments|cost|costs)/.test(normalized);
  const wantsList = /(show|list|display|find|see|tell me|what are|which are|give me)/.test(normalized);
  const wantsAmount = /(how much|total|amount|sum|spent|spend|cost|costs)/.test(normalized);
  const wantsTop = /(highest|largest|biggest|top|most)/.test(normalized);
  const wantsRecent = /(recent|latest|last few|newest)/.test(normalized);
  const priorCategory = findLastReferencedCategory(conversation, Object.keys(insights.categories.totals));
  const resolvedCategory = category || ((/that category|same category|those|it/.test(normalized)) ? priorCategory : null);

  if (resolvedCategory && wantsList && hasExpenseWords) {
    return { intent: "category_expenses", category: resolvedCategory };
  }

  if (resolvedCategory && wantsAmount) {
    return { intent: "category_total", category: resolvedCategory };
  }

  if (/today/.test(normalized) && wantsAmount) {
    return { intent: "today_total" };
  }

  if (/(last month|previous month)/.test(normalized) && wantsAmount) {
    return { intent: "last_month_total" };
  }

  if (/(this month|current month|month so far)/.test(normalized) && wantsAmount) {
    return { intent: "this_month_total" };
  }

  if (/(this week|current week|week so far)/.test(normalized) && wantsAmount) {
    return { intent: "this_week_total" };
  }

  if (/(overall|all time|total expenses|total spent)/.test(normalized) && wantsAmount) {
    return { intent: "overall_total" };
  }

  if (/(compare|difference|vs|versus)/.test(normalized) && /(this month|last month|previous month)/.test(normalized)) {
    return { intent: "month_comparison" };
  }

  if (/(who owes me the most|top debtor|owes me most|owes me the most)/.test(normalized)) {
    return { intent: "top_debtor" };
  }

  if (/(who do i owe|what do i owe|owe the most|i owe the most)/.test(normalized)) {
    return { intent: "top_creditor" };
  }

  if (wantsTop && /(category|categories)/.test(normalized)) {
    return { intent: "highest_category" };
  }

  if (wantsTop && /(expense|payment|spend)/.test(normalized) && /(this week|week)/.test(normalized)) {
    return { intent: "largest_expense_this_week" };
  }

  if (wantsTop && /(expense|payment|spend)/.test(normalized) && /(this month|month)/.test(normalized)) {
    return { intent: "largest_expense_this_month" };
  }

  if (wantsTop && /(expense|payment|spend)/.test(normalized)) {
    return { intent: "largest_expense_overall" };
  }

  if (/(which friends owe me|who owes me|owe me money|balances across groups|across groups)/.test(normalized)) {
    return { intent: "who_owes_me" };
  }

  if (wantsRecent && hasExpenseWords) {
    return { intent: "recent_expenses" };
  }

  if (/(summary|overview|insight|insights|snapshot)/.test(normalized)) {
    return { intent: "summary" };
  }

  return { intent: "generic" };
}

function buildIntentReply(intent, insights) {
  switch (intent.intent) {
    case "category_expenses":
      return buildCategoryExpensesReply(intent.category, insights);
    case "category_total":
      return buildCategoryTotalReply(intent.category, insights);
    case "last_month_total":
      return `Last month you spent INR ${Number(insights.totals.lastMonth || 0).toFixed(2)} between ${insights.periods.lastMonth.rangeStart} and ${insights.periods.lastMonth.rangeEnd}.`;
    case "this_month_total":
      return `This month you've spent INR ${Number(insights.totals.thisMonth || 0).toFixed(2)} so far.`;
    case "this_week_total":
      return `This week you've spent INR ${Number(insights.totals.thisWeek || 0).toFixed(2)} so far.`;
    case "today_total":
      return buildTodayTotalReply(insights);
    case "overall_total":
      return `Across all visible expenses, you've spent INR ${Number(insights.totals.overall || 0).toFixed(2)} over ${Number(insights.totals.expenseCount || 0)} expense${Number(insights.totals.expenseCount || 0) === 1 ? "" : "s"}.`;
    case "month_comparison":
      return buildMonthComparisonReply(insights);
    case "top_debtor":
      return buildTopDebtorReply(insights);
    case "top_creditor":
      return buildTopCreditorReply(insights);
    case "who_owes_me":
      return buildWhoOwesMeReply(insights);
    case "highest_category":
      return buildHighestCategoryReply(insights);
    case "largest_expense_this_week":
      return buildLargestExpenseReply(insights.largestExpenses.thisWeek, "this week");
    case "largest_expense_this_month":
      return buildLargestExpenseReply(insights.largestExpenses.thisMonth, "this month");
    case "largest_expense_overall":
      return buildLargestExpenseReply(insights.largestExpenses.overall, "overall");
    case "recent_expenses":
      return buildRecentExpensesReply(insights);
    case "summary":
      return buildSummaryReply(insights);
    default:
      return buildSummaryReply(insights);
  }
}

function buildCategoryExpensesReply(category, insights) {
  const matchingExpenses = listExpensesForCategory(insights, category);
  if (!matchingExpenses.length) {
    return `I couldn't find any ${category} expenses yet.`;
  }

  const total = matchingExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  const preview = matchingExpenses
    .slice(0, 5)
    .map((expense) => `${expense.title} on ${expense.date} for INR ${Number(expense.amount || 0).toFixed(2)}`)
    .join("; ");

  return `You have ${matchingExpenses.length} ${category} expense${matchingExpenses.length === 1 ? "" : "s"} totaling INR ${total.toFixed(2)}. Recent ones: ${preview}.`;
}

function buildCategoryTotalReply(category, insights) {
  const amount = Number(insights.categories.totals[category] || 0);
  const matchingExpenses = listExpensesForCategory(insights, category);
  const dateRange = matchingExpenses.length
    ? ` across ${matchingExpenses.length} expense${matchingExpenses.length === 1 ? "" : "s"}`
    : "";
  return `You've spent INR ${amount.toFixed(2)} on ${category}${dateRange}.`;
}

function buildTodayTotalReply(insights) {
  const todayExpenses = (insights.expenses || []).filter((expense) => expense.date === insights.referenceDate);
  const total = todayExpenses.reduce((sum, expense) => sum + Number(expense.amount || 0), 0);
  return `Today you've spent INR ${total.toFixed(2)} across ${todayExpenses.length} expense${todayExpenses.length === 1 ? "" : "s"}.`;
}

function buildTopDebtorReply(insights) {
  const debtor = insights.owedSummary.topDebtor;
  return debtor
    ? `${debtor.displayName} owes you the most right now: INR ${Number(debtor.netAmount || 0).toFixed(2)}.`
    : "Nobody owes you money right now based on your shared expenses.";
}

function buildTopCreditorReply(insights) {
  const creditor = insights.owedSummary.topCreditor;
  return creditor
    ? `You owe ${creditor.displayName} the most right now: INR ${Math.abs(Number(creditor.netAmount || 0)).toFixed(2)}.`
    : "You don't currently owe anyone based on your shared expenses.";
}

function buildWhoOwesMeReply(insights) {
  const debtors = insights.owedSummary.peopleWhoOweUser || [];
  if (!debtors.length) {
    return "No one currently owes you money across your visible shared expenses.";
  }

  const summary = debtors
    .slice(0, 5)
    .map((item) => `${item.displayName} owes INR ${Number(item.netAmount || 0).toFixed(2)}`)
    .join(", ");
  return `People who owe you money: ${summary}.`;
}

function buildHighestCategoryReply(insights) {
  if (!insights.categories.highest) {
    return "You don't have enough expense data yet to identify a highest category.";
  }

  const { category, amount } = insights.categories.highest;
  const sortedCategories = Object.entries(insights.categories.totals)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 3)
    .map(([name, total]) => `${name} (INR ${Number(total || 0).toFixed(2)})`)
    .join(", ");
  return `Your highest spending category is ${category} at INR ${Number(amount || 0).toFixed(2)}. Top categories: ${sortedCategories}.`;
}

function buildRecentExpensesReply(insights) {
  const recentExpenses = insights.recentExpenses || [];
  if (!recentExpenses.length) {
    return "You don't have any expenses yet.";
  }

  const summary = recentExpenses
    .slice(0, 5)
    .map((expense) => `${expense.title} on ${expense.date} for INR ${Number(expense.amount || 0).toFixed(2)} in ${expense.category}`)
    .join("; ");
  return `Your most recent expenses are: ${summary}.`;
}

function buildSummaryReply(insights) {
  const topCategory = insights.categories.highest
    ? `${insights.categories.highest.category} (INR ${Number(insights.categories.highest.amount || 0).toFixed(2)})`
    : "no clear top category yet";
  const balanceLine = insights.owedSummary.topDebtor
    ? `${insights.owedSummary.topDebtor.displayName} owes you the most.`
    : insights.owedSummary.topCreditor
      ? `You owe ${insights.owedSummary.topCreditor.displayName} the most.`
      : "You are settled up on shared balances right now.";

  return `This month you've spent INR ${Number(insights.totals.thisMonth || 0).toFixed(2)}, last month you spent INR ${Number(insights.totals.lastMonth || 0).toFixed(2)}, and your top category is ${topCategory}. ${balanceLine}`;
}

function buildMonthComparisonReply(insights) {
  const current = Number(insights.totals.thisMonth || 0);
  const previous = Number(insights.totals.lastMonth || 0);
  const difference = current - previous;
  const direction = difference > 0 ? "higher" : difference < 0 ? "lower" : "the same";
  const differenceText = difference === 0 ? "There is no difference." : `That's INR ${Math.abs(difference).toFixed(2)} ${difference > 0 ? "more" : "less"} than last month.`;
  return `This month you have spent INR ${current.toFixed(2)} and last month you spent INR ${previous.toFixed(2)}. Your spending is ${direction}. ${differenceText}`;
}

function buildLargestExpenseReply(expense, scopeLabel) {
  if (!expense) {
    if (scopeLabel === "this week") {
      return "I couldn't find any expenses for this week. You can also ask for your biggest expense this month or overall.";
    }
    return `I couldn't find any expenses for ${scopeLabel}.`;
  }

  return `Your biggest expense ${scopeLabel} was ${expense.title} on ${expense.date} for INR ${Number(expense.amount || 0).toFixed(2)} in ${expense.category}.`;
}

function buildSmartFallbackReply(message, insights, conversation = { messages: [] }) {
  const normalized = normalizeText(message);

  if (/(trend|pattern|watch out|improve|save money|cut down|reduce)/.test(normalized)) {
    const topCategory = insights.categories.highest;
    if (topCategory) {
      return `Your biggest spending area is ${topCategory.category} at INR ${Number(topCategory.amount || 0).toFixed(2)}. If you want to cut spending, that's the first category I'd review.`;
    }
  }

  if (/(compare|difference|vs|versus)/.test(normalized) && /(last month|this month)/.test(normalized)) {
    const difference = Number(insights.totals.thisMonth || 0) - Number(insights.totals.lastMonth || 0);
    const direction = difference > 0 ? "up" : difference < 0 ? "down" : "flat";
    return `Compared with last month, your spending is ${direction}. This month: INR ${Number(insights.totals.thisMonth || 0).toFixed(2)}. Last month: INR ${Number(insights.totals.lastMonth || 0).toFixed(2)}.`;
  }

  const priorReference = conversation.messages.length ? " I also kept the recent chat context in mind." : "";
  return `${buildSummaryReply(insights)}${priorReference}`;
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
  const knownCategories = availableCategories.length ? availableCategories : DEFAULT_CATEGORIES;
  const aliases = buildCategoryAliases(knownCategories);

  for (const [alias, category] of aliases.entries()) {
    if (message.includes(alias)) {
      return category;
    }
  }

  return null;
}

function findLastReferencedCategory(conversation, availableCategories) {
  const knownCategories = availableCategories.length ? availableCategories : DEFAULT_CATEGORIES;
  const recentMessages = (conversation.messages || []).slice().reverse();

  for (const message of recentMessages) {
    const found = findCategoryMention(normalizeText(message.content || ""), knownCategories);
    if (found) {
      return found;
    }
  }

  return null;
}

function buildCategoryAliases(categories) {
  const aliases = new Map();

  categories.forEach((category) => {
    const normalized = normalizeText(category);
    aliases.set(normalized, category);
  });

  aliases.set("travel", aliases.get("travel") || "Travel");
  aliases.set("trip", aliases.get("travel") || "Travel");
  aliases.set("transport", aliases.get("travel") || "Travel");
  aliases.set("transportation", aliases.get("travel") || "Travel");
  aliases.set("food", aliases.get("food") || "Food");
  aliases.set("dining", aliases.get("food") || "Food");
  aliases.set("restaurant", aliases.get("food") || "Food");
  aliases.set("groceries", aliases.get("food") || "Food");
  aliases.set("shopping", aliases.get("shopping") || "Shopping");
  aliases.set("bills", aliases.get("bills") || "Bills");
  aliases.set("utilities", aliases.get("bills") || "Bills");
  aliases.set("entertainment", aliases.get("entertainment") || "Entertainment");
  aliases.set("health", aliases.get("health") || "Health");
  aliases.set("medical", aliases.get("health") || "Health");
  aliases.set("education", aliases.get("education") || "Education");

  return aliases;
}

function extractResponseText(payload) {
  return (payload.output || [])
    .flatMap((item) => item.content || [])
    .map((item) => item.text || "")
    .join(" ");
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

module.exports = {
  answerExpenseQuestion,
  getConversationState,
};
