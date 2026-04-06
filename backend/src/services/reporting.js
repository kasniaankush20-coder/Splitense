const { sendReportNotifications } = require("./notifications");
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
const { getAccessibleExpenses } = require("./expenses");

function createReportingScheduler(app) {
  const intervalMs = 60 * 60 * 1000;
  setInterval(() => {
    ensureReportsUpToDate(app);
  }, intervalMs);
}

async function ensureReportsUpToDate(app) {
  const database = app.locals.database;
  const today = getDateOnly();

  for (const user of database.users) {
    const weeklyKey = `${user.id}:${startOfWeek(today)}`;
    const monthlyKey = `${user.id}:${today.slice(0, 7)}`;
    let changed = false;

    if (!database.reports.weekly.some((report) => report.periodKey === weeklyKey)) {
      const weeklyReport = buildWeeklyReport(database, user, today);
      database.reports.weekly.unshift(weeklyReport);
      await sendReportNotifications(database, user, weeklyReport);
      changed = true;
    }

    if (!database.reports.monthly.some((report) => report.periodKey === monthlyKey)) {
      const monthlyReport = buildMonthlyReport(database, user, today);
      database.reports.monthly.unshift(monthlyReport);
      await sendReportNotifications(database, user, monthlyReport);
      changed = true;
    }

    if (changed) {
      database.reports.lastWeeklySentAt = new Date().toISOString();
      database.reports.lastMonthlySentAt = new Date().toISOString();
    }
  }

  app.locals.saveDatabase();
}

async function runReportsNow(app, user) {
  const database = app.locals.database;
  const today = getDateOnly();
  const weeklyReport = buildWeeklyReport(database, user, today);
  const monthlyReport = buildMonthlyReport(database, user, today);

  database.reports.weekly.unshift(weeklyReport);
  database.reports.monthly.unshift(monthlyReport);

  const notifications = [
    ...(await sendReportNotifications(database, user, weeklyReport)),
    ...(await sendReportNotifications(database, user, monthlyReport)),
  ];

  app.locals.saveDatabase();
  return { weeklyReport, monthlyReport, notifications };
}

function getLatestWeeklyReport(database, user) {
  return database.reports.weekly.find((report) => report.userId === user.id) || null;
}

function getLatestMonthlyReport(database, user) {
  return database.reports.monthly.find((report) => report.userId === user.id) || null;
}

function buildWeeklyReport(database, user, dateString) {
  const rangeStart = startOfWeek(dateString);
  const rangeEnd = endOfWeek(dateString);
  const expenses = getAccessibleExpenses(database, user).filter((expense) => isDateInRange(expense.date, rangeStart, rangeEnd));
  const totalSpent = sumAmounts(expenses);
  const categoryTotals = groupTotalsByCategory(expenses);

  return {
    id: generateId("weekly_report"),
    userId: user.id,
    type: "weekly",
    periodKey: `${user.id}:${rangeStart}`,
    rangeStart,
    rangeEnd,
    totalSpent,
    categoryTotals,
    chartData: buildChartData(categoryTotals),
    message: buildWeeklyMessage(rangeStart, rangeEnd, totalSpent, categoryTotals),
    createdAt: new Date().toISOString(),
  };
}

function buildMonthlyReport(database, user, dateString) {
  const rangeStart = startOfMonth(dateString);
  const rangeEnd = endOfMonth(dateString);
  const expenses = getAccessibleExpenses(database, user).filter((expense) => isDateInRange(expense.date, rangeStart, rangeEnd));
  const totalSpent = sumAmounts(expenses);
  const categoryTotals = groupTotalsByCategory(expenses);
  const highestCategory = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1])[0] || null;

  return {
    id: generateId("monthly_report"),
    userId: user.id,
    type: "monthly",
    periodKey: `${user.id}:${rangeStart.slice(0, 7)}`,
    rangeStart,
    rangeEnd,
    totalSpent,
    highestCategory,
    categoryTotals,
    chartData: buildChartData(categoryTotals),
    trend: "User-scoped trend available in future refinements.",
    message: buildMonthlyMessage(rangeStart, rangeEnd, totalSpent, highestCategory),
    createdAt: new Date().toISOString(),
  };
}

function buildChartData(categoryTotals) {
  return Object.entries(categoryTotals).map(([label, value]) => ({ label, value }));
}

function buildWeeklyMessage(rangeStart, rangeEnd, totalSpent, categoryTotals) {
  const topCategories = formatTopCategories(categoryTotals);
  return [
    `Weekly summary (${rangeStart} to ${rangeEnd})`,
    `Total spent: INR ${totalSpent.toFixed(2)}`,
    `Top categories: ${topCategories}`,
  ].join("\n");
}

function buildMonthlyMessage(rangeStart, rangeEnd, totalSpent, highestCategory) {
  const highest = highestCategory ? `${highestCategory[0]} (INR ${highestCategory[1].toFixed(2)})` : "No category data";
  return [
    `Monthly report (${rangeStart} to ${rangeEnd})`,
    `Total spent: INR ${totalSpent.toFixed(2)}`,
    `Highest category: ${highest}`,
  ].join("\n");
}

function formatTopCategories(categoryTotals) {
  const entries = Object.entries(categoryTotals).sort((a, b) => b[1] - a[1]).slice(0, 3);
  if (!entries.length) {
    return "No expenses recorded.";
  }
  return entries.map(([category, total]) => `${category} (INR ${total.toFixed(2)})`).join(", ");
}

module.exports = {
  buildMonthlyReport,
  buildWeeklyReport,
  createReportingScheduler,
  ensureReportsUpToDate,
  getLatestMonthlyReport,
  getLatestWeeklyReport,
  runReportsNow,
};
