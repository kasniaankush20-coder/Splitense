const fs = require("fs");
const path = require("path");
const { generateId } = require("./utils");

const dataDirectory = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, "..", "..", "data");
const databasePath = path.join(dataDirectory, "db.json");

function createDefaultDatabase() {
  return {
    schemaVersion: 4,
    users: [],
    expenses: [],
    groups: [],
    ai: {
      conversations: [],
    },
    reports: {
      weekly: [],
      monthly: [],
      notifications: [],
      lastWeeklySentAt: null,
      lastMonthlySentAt: null,
    },
  };
}

function ensureDatabaseFile() {
  if (!fs.existsSync(dataDirectory)) {
    fs.mkdirSync(dataDirectory, { recursive: true });
  }

  if (!fs.existsSync(databasePath)) {
    fs.writeFileSync(databasePath, JSON.stringify(createDefaultDatabase(), null, 2));
  }
}

function loadDatabase() {
  ensureDatabaseFile();

  try {
    const raw = fs.readFileSync(databasePath, "utf8");
    const parsed = JSON.parse(raw);
    return migrateDatabase(parsed);
  } catch (error) {
    console.error("Failed to read database, recreating.", error);
    const fallback = createDefaultDatabase();
    fs.writeFileSync(databasePath, JSON.stringify(fallback, null, 2));
    return fallback;
  }
}

function saveDatabase(database) {
  ensureDatabaseFile();
  fs.writeFileSync(databasePath, JSON.stringify(database, null, 2));
}

function migrateDatabase(database) {
  if (database.schemaVersion === 4 && Array.isArray(database.users)) {
    return {
      ...database,
      ai: {
        conversations: Array.isArray(database.ai?.conversations) ? database.ai.conversations : [],
      },
    };
  }

  if (database.schemaVersion === 3 && Array.isArray(database.users)) {
    return database;
  }

  if (database.schemaVersion === 2 && Array.isArray(database.users)) {
    return {
      ...database,
      schemaVersion: 4,
      users: database.users.map((user) => ({
        ...user,
        customCategoryRules: Array.isArray(user.customCategoryRules) ? user.customCategoryRules : [],
      })),
      ai: {
        conversations: [],
      },
    };
  }

  const next = createDefaultDatabase();
  const legacySettings = database.settings || {};
  const legacyUser = {
    id: generateId("user"),
    displayName: legacySettings.userName || "You",
    reportEmail: legacySettings.reportEmail || "",
    whatsappNumber: legacySettings.whatsappNumber || "",
    emailEnabled: Boolean(legacySettings.emailEnabled),
    whatsappEnabled: Boolean(legacySettings.whatsappEnabled),
    customCategoryRules: [],
    createdAt: new Date().toISOString(),
  };

  next.users.push(legacyUser);

  const legacyGroups = Array.isArray(database.groups) ? database.groups : [];
  const memberMap = new Map([[legacyUser.displayName, legacyUser.id]]);

  legacyGroups.forEach((group) => {
    const memberUserIds = [];
    const pendingMemberNames = [];

    (group.members || []).forEach((memberName) => {
      const normalized = String(memberName || "").trim();
      if (!normalized) {
        return;
      }

      if (normalized === legacyUser.displayName) {
        memberUserIds.push(legacyUser.id);
        return;
      }

      pendingMemberNames.push(normalized);
    });

    next.groups.push({
      id: group.id || generateId("group"),
      name: group.name === "EDuplex 4" ? "Shared group" : (group.name || "Shared group"),
      inviteCode: group.inviteCode || randomCode(),
      createdByUserId: legacyUser.id,
      memberUserIds: unique(memberUserIds.length ? memberUserIds : [legacyUser.id]),
      pendingMemberNames: unique(pendingMemberNames),
      createdAt: group.createdAt || new Date().toISOString(),
    });
  });

  const legacyExpenses = Array.isArray(database.expenses) ? database.expenses : [];
  legacyExpenses.forEach((expense) => {
    const mappedGroup = expense.groupId ? next.groups.find((group) => group.id === expense.groupId) : null;
    const ownerUserId = legacyUser.id;
    const paidByUserId = resolveLegacyUserId(expense.paidBy, legacyUser, memberMap, next.users);
    const allocations = (expense.split?.allocations || []).map((allocation) => ({
      userId: resolveLegacyUserId(allocation.member, legacyUser, memberMap, next.users),
      amount: Number(allocation.amount || 0),
    }));

    next.expenses.push({
      id: expense.id || generateId("expense"),
      title: expense.title || expense.category || "Expense",
      amount: Number(expense.amount || 0),
      category: expense.category || "Other",
      date: expense.date,
      notes: expense.notes || "",
      type: expense.type || (mappedGroup ? "shared" : "personal"),
      ownerUserId,
      groupId: mappedGroup ? mappedGroup.id : null,
      paidByUserId: paidByUserId || ownerUserId,
      split: expense.split ? {
        mode: expense.split.mode || "equal",
        allocations,
      } : null,
      createdAt: expense.createdAt || new Date().toISOString(),
      updatedAt: expense.updatedAt || new Date().toISOString(),
    });
  });

  const weeklyReports = Array.isArray(database.reports?.weekly) ? database.reports.weekly : [];
  const monthlyReports = Array.isArray(database.reports?.monthly) ? database.reports.monthly : [];
  const notifications = Array.isArray(database.reports?.notifications) ? database.reports.notifications : [];

  next.reports.weekly = weeklyReports.map((report) => ({ ...report, userId: legacyUser.id }));
  next.reports.monthly = monthlyReports.map((report) => ({ ...report, userId: legacyUser.id }));
  next.reports.notifications = notifications.map((notification) => ({ ...notification, userId: legacyUser.id }));
  next.reports.lastWeeklySentAt = database.reports?.lastWeeklySentAt || null;
  next.reports.lastMonthlySentAt = database.reports?.lastMonthlySentAt || null;
  next.ai.conversations = Array.isArray(database.ai?.conversations) ? database.ai.conversations : [];

  return next;
}

function resolveLegacyUserId(name, legacyUser, memberMap, users) {
  const normalized = String(name || "").trim();
  if (!normalized) {
    return legacyUser.id;
  }

  if (normalized === legacyUser.displayName) {
    return legacyUser.id;
  }

  if (memberMap.has(normalized)) {
    return memberMap.get(normalized);
  }

  const user = {
    id: generateId("user"),
    displayName: normalized,
    reportEmail: "",
    whatsappNumber: "",
    emailEnabled: false,
    whatsappEnabled: false,
    customCategoryRules: [],
    createdAt: new Date().toISOString(),
  };
  users.push(user);
  memberMap.set(normalized, user.id);
  return user.id;
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function randomCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

module.exports = {
  createDefaultDatabase,
  loadDatabase,
  saveDatabase,
};
