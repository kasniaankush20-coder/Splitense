const {
  endOfMonth,
  endOfWeek,
  generateId,
  getDateOnly,
  groupTotalsByCategory,
  isDateInRange,
  startOfMonth,
  startOfWeek,
  sumAmounts,
} = require("./utils");
const { maybeLearnFromCorrection, predictCategory } = require("./categorization");

function getExpenses(database, user) {
  return getAccessibleExpenses(database, user).sort((a, b) => new Date(b.date) - new Date(a.date));
}

function createExpense(database, user, payload) {
  const expense = normalizeExpense(applyPredictedCategory(database, user, payload), {
    ownerUserId: user.id,
    paidByUserId: user.id,
    type: "personal",
  });
  database.expenses.unshift(expense);
  return expense;
}

function updateExpense(database, user, expenseId, payload) {
  const index = database.expenses.findIndex((expense) => expense.id === expenseId);

  if (index === -1) {
    return null;
  }

  const currentExpense = database.expenses[index];
  if (!canAccessExpense(database, user, currentExpense)) {
    return null;
  }

  if (currentExpense.type === "personal" && currentExpense.ownerUserId !== user.id) {
    return null;
  }

  const previousExpense = { ...currentExpense };
  const updatedExpense = normalizeExpense(applyPredictedCategory(database, user, { ...currentExpense, ...payload }), currentExpense);
  database.expenses[index] = updatedExpense;
  maybeLearnFromCorrection(database, user, previousExpense, updatedExpense);
  return updatedExpense;
}

function deleteExpense(database, user, expenseId) {
  const expense = database.expenses.find((item) => item.id === expenseId);

  if (!expense || !canAccessExpense(database, user, expense)) {
    return false;
  }

  if (expense.type === "personal" && expense.ownerUserId !== user.id) {
    return false;
  }

  if (expense.type === "shared") {
    const group = database.groups.find((item) => item.id === expense.groupId);
    if (!group || !group.memberUserIds.includes(user.id)) {
      return false;
    }
  }

  database.expenses = database.expenses.filter((item) => item.id !== expenseId);
  return true;
}

function getDashboardSummary(database, user, selectedDate = getDateOnly()) {
  const expenses = getAccessibleExpenses(database, user);
  const personalExpenses = expenses.filter((expense) => expense.type === "personal");
  const sharedExpenses = expenses.filter((expense) => expense.type === "shared");
  const todayExpenses = expenses.filter((expense) => expense.date === selectedDate);
  const weekStart = startOfWeek(selectedDate);
  const weekEnd = endOfWeek(selectedDate);
  const monthStart = startOfMonth(selectedDate);
  const monthEnd = endOfMonth(selectedDate);
  const weekExpenses = expenses.filter((expense) => isDateInRange(expense.date, weekStart, weekEnd));
  const monthExpenses = expenses.filter((expense) => isDateInRange(expense.date, monthStart, monthEnd));

  return {
    selectedDate,
    metrics: {
      todayTotal: sumAmounts(todayExpenses),
      weeklyTotal: sumAmounts(weekExpenses),
      monthlyTotal: sumAmounts(monthExpenses),
      personalTotal: sumAmounts(personalExpenses),
      sharedTotal: sumAmounts(sharedExpenses),
      expenseCount: expenses.length,
    },
    weekly: {
      rangeStart: weekStart,
      rangeEnd: weekEnd,
      categoryTotals: groupTotalsByCategory(weekExpenses),
      trend: buildDateTrend(weekExpenses, weekStart, 7),
    },
    monthly: {
      rangeStart: monthStart,
      rangeEnd: monthEnd,
      categoryTotals: groupTotalsByCategory(monthExpenses),
      highestCategory: getHighestCategory(groupTotalsByCategory(monthExpenses)),
    },
    recentExpenses: expenses.slice(0, 12),
  };
}

function getAccessibleExpenses(database, user) {
  const allowedGroupIds = new Set(
    database.groups
      .filter((group) => group.memberUserIds.includes(user.id))
      .map((group) => group.id)
  );

  return database.expenses.filter((expense) => canAccessExpense(database, user, expense, allowedGroupIds));
}

function canAccessExpense(database, user, expense, cachedAllowedGroupIds) {
  if (expense.type === "personal") {
    return expense.ownerUserId === user.id;
  }

  const allowedGroupIds = cachedAllowedGroupIds || new Set(
    database.groups
      .filter((group) => group.memberUserIds.includes(user.id))
      .map((group) => group.id)
  );

  return Boolean(expense.groupId && allowedGroupIds.has(expense.groupId));
}

function normalizeExpense(payload, currentExpense = {}) {
  return {
    id: currentExpense.id || generateId("expense"),
    amount: Number(payload.amount),
    category: payload.category || "Other",
    date: payload.date || getDateOnly(),
    notes: payload.notes || "",
    title: payload.title || payload.category || "Expense",
    type: payload.type || currentExpense.type || "personal",
    ownerUserId: payload.ownerUserId || currentExpense.ownerUserId || null,
    groupId: payload.groupId || currentExpense.groupId || null,
    paidByUserId: payload.paidByUserId || currentExpense.paidByUserId || null,
    split: payload.split || currentExpense.split || null,
    createdAt: currentExpense.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function applyPredictedCategory(database, user, payload) {
  if (payload.category) {
    return payload;
  }

  const prediction = predictCategory(database, user, {
    merchant: payload.title,
    keyword: payload.title,
    notes: payload.notes,
    amount: payload.amount,
    date: payload.date,
  });

  return {
    ...payload,
    category: prediction.category || "Other",
  };
}

function buildDateTrend(expenses, startDate, days) {
  const buckets = [];
  const start = new Date(`${startDate}T00:00:00`);

  for (let index = 0; index < days; index += 1) {
    const current = new Date(start);
    current.setDate(start.getDate() + index);
    const dateKey = getDateOnly(current);
    const total = sumAmounts(expenses.filter((expense) => expense.date === dateKey));
    buckets.push({ date: dateKey, total });
  }

  return buckets;
}

function getHighestCategory(categoryTotals) {
  return Object.entries(categoryTotals).sort((a, b) => b[1] - a[1])[0] || null;
}

module.exports = {
  canAccessExpense,
  createExpense,
  deleteExpense,
  getAccessibleExpenses,
  getDashboardSummary,
  getExpenses,
  updateExpense,
};
