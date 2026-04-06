const express = require("express");

const {
  createExpense,
  deleteExpense,
  getDashboardSummary,
  getExpenses,
  updateExpense,
} = require("../services/expenses");
const {
  createGroup,
  getGroups,
  joinGroupByCode,
  addGroupExpense,
} = require("../services/groups");
const {
  getLatestMonthlyReport,
  getLatestWeeklyReport,
  runReportsNow,
} = require("../services/reporting");
const { getSettings, updateSettings } = require("../services/settings");
const { createSession, getRequestUser, requireAuthenticatedUser } = require("../services/auth");

function createApiRouter(app) {
  const router = express.Router();
  const requireUser = requireAuthenticatedUser(app);

  router.get("/health", (request, response) => {
    response.json({ ok: true });
  });

  router.post("/session", (request, response) => {
    const user = createSession(app.locals.database, request.body);

    if (!user) {
      response.status(400).json({ message: "Display name is required" });
      return;
    }

    app.locals.saveDatabase();
    response.status(201).json(user);
  });

  router.get("/session", requireUser, (request, response) => {
    response.json(request.currentUser);
  });

  router.use(requireUser);

  router.get("/expenses", (request, response) => {
    response.json(getExpenses(app.locals.database, request.currentUser));
  });

  router.post("/expenses", (request, response) => {
    const expense = createExpense(app.locals.database, request.currentUser, request.body);
    app.locals.saveDatabase();
    response.status(201).json(expense);
  });

  router.put("/expenses/:expenseId", (request, response) => {
    const updatedExpense = updateExpense(app.locals.database, request.currentUser, request.params.expenseId, request.body);

    if (!updatedExpense) {
      response.status(404).json({ message: "Expense not found or not accessible" });
      return;
    }

    app.locals.saveDatabase();
    response.json(updatedExpense);
  });

  router.delete("/expenses/:expenseId", (request, response) => {
    const deleted = deleteExpense(app.locals.database, request.currentUser, request.params.expenseId);

    if (!deleted) {
      response.status(404).json({ message: "Expense not found or not accessible" });
      return;
    }

    app.locals.saveDatabase();
    response.status(204).send();
  });

  router.get("/dashboard", (request, response) => {
    response.json(getDashboardSummary(app.locals.database, request.currentUser, request.query.date));
  });

  router.get("/groups", (request, response) => {
    response.json(getGroups(app.locals.database, request.currentUser));
  });

  router.post("/groups", (request, response) => {
    const group = createGroup(app.locals.database, request.currentUser, request.body);
    app.locals.saveDatabase();
    response.status(201).json(group);
  });

  router.post("/groups/join", (request, response) => {
    const group = joinGroupByCode(app.locals.database, request.currentUser, request.body);

    if (!group) {
      response.status(404).json({ message: "Group invite code not found" });
      return;
    }

    app.locals.saveDatabase();
    response.json(group);
  });

  router.post("/groups/:groupId/expenses", (request, response) => {
    const sharedExpense = addGroupExpense(app.locals.database, request.currentUser, request.params.groupId, request.body);

    if (!sharedExpense) {
      response.status(404).json({ message: "Group not found or access denied" });
      return;
    }

    app.locals.saveDatabase();
    response.status(201).json(sharedExpense);
  });

  router.get("/reports/weekly/latest", (request, response) => {
    response.json(getLatestWeeklyReport(app.locals.database, request.currentUser));
  });

  router.get("/reports/monthly/latest", (request, response) => {
    response.json(getLatestMonthlyReport(app.locals.database, request.currentUser));
  });

  router.post("/reports/run", async (request, response) => {
    const result = await runReportsNow(app, request.currentUser);
    response.json(result);
  });

  router.get("/settings", (request, response) => {
    response.json(getSettings(app.locals.database, request.currentUser));
  });

  router.put("/settings", (request, response) => {
    const settings = updateSettings(app.locals.database, request.currentUser, request.body);
    app.locals.saveDatabase();
    response.json(settings);
  });

  return router;
}

module.exports = {
  createApiRouter,
};
