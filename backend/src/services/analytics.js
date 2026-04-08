const {
  endOfMonth,
  endOfWeek,
  getDateOnly,
  groupTotalsByCategory,
  isDateInRange,
  startOfMonth,
  startOfWeek,
  sumAmounts,
} = require("./utils");
const { getAccessibleExpenses } = require("./expenses");

function buildExpenseInsights(database, user, referenceDate = getDateOnly()) {
  const expenses = getAccessibleExpenses(database, user).slice().sort((a, b) => new Date(b.date) - new Date(a.date));
  const currentMonthStart = startOfMonth(referenceDate);
  const currentMonthEnd = endOfMonth(referenceDate);
  const previousMonthReference = shiftMonth(referenceDate, -1);
  const previousMonthStart = startOfMonth(previousMonthReference);
  const previousMonthEnd = endOfMonth(previousMonthReference);
  const currentWeekStart = startOfWeek(referenceDate);
  const currentWeekEnd = endOfWeek(referenceDate);
  const categoryTotals = groupTotalsByCategory(expenses);
  const highestCategory = Object.entries(categoryTotals).sort((left, right) => right[1] - left[1])[0] || null;
  const thisMonthExpenses = expenses.filter((expense) => isDateInRange(expense.date, currentMonthStart, currentMonthEnd));
  const lastMonthExpenses = expenses.filter((expense) => isDateInRange(expense.date, previousMonthStart, previousMonthEnd));
  const thisWeekExpenses = expenses.filter((expense) => isDateInRange(expense.date, currentWeekStart, currentWeekEnd));
  const owedSummary = buildOwedSummary(database, user, expenses);

  return {
    generatedAt: new Date().toISOString(),
    referenceDate,
    expenses,
    totals: {
      overall: sumAmounts(expenses),
      thisMonth: sumAmounts(thisMonthExpenses),
      lastMonth: sumAmounts(lastMonthExpenses),
      thisWeek: sumAmounts(thisWeekExpenses),
      expenseCount: expenses.length,
    },
    periods: {
      thisMonth: { rangeStart: currentMonthStart, rangeEnd: currentMonthEnd, expenses: thisMonthExpenses },
      lastMonth: { rangeStart: previousMonthStart, rangeEnd: previousMonthEnd, expenses: lastMonthExpenses },
      thisWeek: { rangeStart: currentWeekStart, rangeEnd: currentWeekEnd, expenses: thisWeekExpenses },
    },
    categories: {
      totals: categoryTotals,
      highest: highestCategory ? { category: highestCategory[0], amount: highestCategory[1] } : null,
    },
    owedSummary,
    largestExpenses: {
      overall: getLargestExpense(expenses),
      thisMonth: getLargestExpense(thisMonthExpenses),
      lastMonth: getLargestExpense(lastMonthExpenses),
      thisWeek: getLargestExpense(thisWeekExpenses),
    },
    recentExpenses: expenses.slice(0, 12),
  };
}

function listExpensesForCategory(insights, category) {
  const normalizedCategory = normalizeText(category);
  return (insights.expenses || []).filter((expense) => normalizeText(expense.category) === normalizedCategory);
}

function buildOwedSummary(database, user, expenses) {
  const balancesByPerson = new Map();

  expenses
    .filter((expense) => expense.type === "shared")
    .forEach((expense) => {
      const payerId = expense.paidByUserId;
      const allocations = Array.isArray(expense.split?.allocations) ? expense.split.allocations : [];

      allocations.forEach((allocation) => {
        if (!allocation.userId || allocation.userId === payerId) {
          return;
        }

        if (payerId === user.id) {
          balancesByPerson.set(allocation.userId, roundCurrency((balancesByPerson.get(allocation.userId) || 0) + Number(allocation.amount || 0)));
          return;
        }

        if (allocation.userId === user.id) {
          balancesByPerson.set(payerId, roundCurrency((balancesByPerson.get(payerId) || 0) - Number(allocation.amount || 0)));
        }
      });
    });

  const people = [...balancesByPerson.entries()]
    .map(([counterpartyUserId, amount]) => ({
      userId: counterpartyUserId,
      displayName: resolveUserName(database, counterpartyUserId),
      netAmount: roundCurrency(amount),
    }))
    .sort((left, right) => Math.abs(right.netAmount) - Math.abs(left.netAmount));

  const peopleWhoOweUser = people.filter((item) => item.netAmount > 0);
  const peopleUserOwes = people.filter((item) => item.netAmount < 0);

  return {
    people,
    peopleWhoOweUser,
    peopleUserOwes,
    topDebtor: peopleWhoOweUser[0] || null,
    topCreditor: peopleUserOwes[0] || null,
  };
}

function resolveUserName(database, userId) {
  return database.users.find((item) => item.id === userId)?.displayName || "Unknown";
}

function shiftMonth(dateString, offset) {
  const date = new Date(`${dateString}T00:00:00`);
  date.setMonth(date.getMonth() + offset);
  return getDateOnly(date);
}

function normalizeText(value) {
  return String(value || "")
    .trim()
    .toLowerCase();
}

function roundCurrency(value) {
  return Number(Number(value || 0).toFixed(2));
}

function getLargestExpense(expenses) {
  return (expenses || [])
    .slice()
    .sort((left, right) => Number(right.amount || 0) - Number(left.amount || 0))[0] || null;
}

module.exports = {
  buildExpenseInsights,
  listExpensesForCategory,
};
