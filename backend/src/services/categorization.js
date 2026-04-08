const { generateId, getDateOnly } = require("./utils");

const DEFAULT_CATEGORY_RULES = [
  { category: "Food", keywords: ["zomato", "swiggy", "restaurant", "cafe", "coffee", "pizza", "burger", "dinner", "lunch", "breakfast", "food"] },
  { category: "Travel", keywords: ["uber", "ola", "rapido", "metro", "train", "flight", "bus", "fuel", "petrol", "diesel", "cab", "travel"] },
  { category: "Shopping", keywords: ["amazon", "flipkart", "myntra", "ajio", "mall", "shopping", "store", "purchase"] },
  { category: "Entertainment", keywords: ["movie", "cinema", "netflix", "spotify", "game", "concert", "entertainment"] },
  { category: "Bills", keywords: ["electricity", "water", "rent", "internet", "wifi", "bill", "recharge", "utility"] },
  { category: "Health", keywords: ["pharmacy", "doctor", "clinic", "hospital", "medicine", "health"] },
  { category: "Education", keywords: ["course", "tuition", "book", "school", "college", "education"] },
];

function predictCategory(database, user, payload = {}) {
  const merchant = String(payload.merchant || payload.title || "").trim();
  const keyword = String(payload.keyword || payload.title || payload.notes || "").trim();
  const combinedText = normalizeText([merchant, keyword, payload.notes].join(" "));

  const userRuleMatch = findMatchingUserRule(user, merchant, keyword, combinedText);
  if (userRuleMatch) {
    return buildPrediction({
      merchant,
      date: payload.date,
      totalAmount: payload.total_amount ?? payload.totalAmount ?? payload.amount,
      category: userRuleMatch.assigned_category,
      confidence: 0.96,
      source: "user_rule",
      matchStrategy: "user_rule",
      needsReview: false,
    });
  }

  const historicalMatch = findHistoricalPattern(database, user, merchant, combinedText);
  if (historicalMatch) {
    return buildPrediction({
      merchant,
      date: payload.date,
      totalAmount: payload.total_amount ?? payload.totalAmount ?? payload.amount,
      category: historicalMatch.category,
      confidence: historicalMatch.confidence,
      source: "ai_default",
      matchStrategy: "historical_pattern",
      needsReview: historicalMatch.confidence < 0.75,
    });
  }

  const defaultMatch = findDefaultCategory(merchant, combinedText);
  if (defaultMatch) {
    return buildPrediction({
      merchant,
      date: payload.date,
      totalAmount: payload.total_amount ?? payload.totalAmount ?? payload.amount,
      category: defaultMatch.category,
      confidence: defaultMatch.confidence,
      source: "ai_default",
      matchStrategy: "default_rule",
      needsReview: defaultMatch.confidence < 0.7,
    });
  }

  return buildPrediction({
    merchant,
    date: payload.date,
    totalAmount: payload.total_amount ?? payload.totalAmount ?? payload.amount,
    category: "Other",
    confidence: 0.35,
    source: "ai_default",
    matchStrategy: "fallback",
    needsReview: true,
  });
}

function processReceipt(database, user, payload = {}) {
  const prediction = predictCategory(database, user, payload);
  return {
    type: "receipt_processed",
    merchant: prediction.merchant,
    date: prediction.date,
    total_amount: prediction.total_amount,
    category: prediction.category,
    confidence: prediction.confidence,
    source: prediction.source,
    needs_review: prediction.needs_review,
  };
}

function learnCategoryRule(database, user, payload = {}) {
  const targetUser = database.users.find((item) => item.id === user.id);
  if (!targetUser) {
    return null;
  }

  if (!Array.isArray(targetUser.customCategoryRules)) {
    targetUser.customCategoryRules = [];
  }

  const merchant = String(payload.merchant || "").trim();
  const keyword = String(payload.keyword || "").trim();
  const assignedCategory = String(payload.assigned_category || payload.assignedCategory || "").trim();

  if (!assignedCategory || (!merchant && !keyword)) {
    return null;
  }

  const merchantKey = normalizeText(merchant);
  const keywordKey = normalizeText(keyword);
  const existingRule = targetUser.customCategoryRules.find((rule) => (
    normalizeText(rule.merchant) === merchantKey && normalizeText(rule.keyword) === keywordKey
  ));

  if (existingRule) {
    existingRule.assigned_category = assignedCategory;
    existingRule.updatedAt = new Date().toISOString();
    return existingRule;
  }

  const rule = {
    id: generateId("rule"),
    keyword,
    merchant,
    assigned_category: assignedCategory,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  targetUser.customCategoryRules.unshift(rule);
  return rule;
}

function getCategoryMemory(user) {
  return {
    custom_category_rules: Array.isArray(user.customCategoryRules) ? user.customCategoryRules : [],
  };
}

function maybeLearnFromCorrection(database, user, previousExpense, updatedExpense) {
  if (!previousExpense || !updatedExpense) {
    return null;
  }

  const previousCategory = String(previousExpense.category || "").trim();
  const nextCategory = String(updatedExpense.category || "").trim();
  if (!nextCategory || previousCategory === nextCategory) {
    return null;
  }

  const merchant = extractMerchant(updatedExpense);
  const keyword = buildKeywordFromExpense(updatedExpense);
  return learnCategoryRule(database, user, {
    merchant,
    keyword,
    assignedCategory: nextCategory,
  });
}

function findMatchingUserRule(user, merchant, keyword, combinedText) {
  const rules = Array.isArray(user.customCategoryRules) ? user.customCategoryRules : [];
  const normalizedMerchant = normalizeText(merchant);
  const normalizedKeyword = normalizeText(keyword);

  return rules.find((rule) => {
    const ruleMerchant = normalizeText(rule.merchant);
    const ruleKeyword = normalizeText(rule.keyword);
    const merchantMatches = ruleMerchant && (normalizedMerchant.includes(ruleMerchant) || combinedText.includes(ruleMerchant));
    const keywordMatches = ruleKeyword && (normalizedKeyword.includes(ruleKeyword) || combinedText.includes(ruleKeyword));
    return merchantMatches || keywordMatches;
  }) || null;
}

function findHistoricalPattern(database, user, merchant, combinedText) {
  const ownedExpenses = database.expenses.filter((expense) => expense.ownerUserId === user.id);
  const categoryScores = new Map();
  const normalizedMerchant = normalizeText(merchant);

  ownedExpenses.forEach((expense) => {
    const expenseMerchant = normalizeText(extractMerchant(expense));
    const expenseText = normalizeText([expense.title, expense.notes].join(" "));

    let score = 0;
    if (normalizedMerchant && expenseMerchant === normalizedMerchant) {
      score += 4;
    }
    if (normalizedMerchant && expenseText.includes(normalizedMerchant)) {
      score += 2;
    }
    if (expenseMerchant && combinedText.includes(expenseMerchant)) {
      score += 2;
    }

    const overlap = calculateKeywordOverlap(combinedText, expenseText);
    score += overlap;

    if (score > 0) {
      categoryScores.set(expense.category, (categoryScores.get(expense.category) || 0) + score);
    }
  });

  const ranked = [...categoryScores.entries()].sort((left, right) => right[1] - left[1]);
  if (!ranked.length) {
    return null;
  }

  const [category, score] = ranked[0];
  return {
    category,
    confidence: score >= 6 ? 0.86 : 0.76,
  };
}

function findDefaultCategory(merchant, combinedText) {
  const merchantText = normalizeText(merchant);

  for (const rule of DEFAULT_CATEGORY_RULES) {
    const matchedKeyword = rule.keywords.find((keyword) => merchantText.includes(keyword) || combinedText.includes(keyword));
    if (matchedKeyword) {
      return {
        category: rule.category,
        confidence: merchantText.includes(matchedKeyword) ? 0.72 : 0.62,
      };
    }
  }

  return null;
}

function buildPrediction({ merchant, date, totalAmount, category, confidence, source, matchStrategy, needsReview }) {
  return {
    merchant: merchant || "",
    date: date || getDateOnly(),
    total_amount: Number(totalAmount || 0),
    category,
    confidence,
    source,
    match_strategy: matchStrategy,
    needs_review: needsReview,
  };
}

function extractMerchant(expense) {
  return String(expense.title || "").trim();
}

function buildKeywordFromExpense(expense) {
  const merchant = extractMerchant(expense);
  const notes = String(expense.notes || "").trim();
  return [merchant, notes].filter(Boolean).join(" ").trim();
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function calculateKeywordOverlap(sourceText, targetText) {
  if (!sourceText || !targetText) {
    return 0;
  }

  const sourceTerms = new Set(sourceText.split(" ").filter((term) => term.length > 2));
  const targetTerms = new Set(targetText.split(" ").filter((term) => term.length > 2));
  let overlap = 0;

  sourceTerms.forEach((term) => {
    if (targetTerms.has(term)) {
      overlap += 1;
    }
  });

  return overlap;
}

module.exports = {
  getCategoryMemory,
  learnCategoryRule,
  maybeLearnFromCorrection,
  predictCategory,
  processReceipt,
};
