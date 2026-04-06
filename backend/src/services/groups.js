const { generateId, getDateOnly } = require("./utils");

function createGroup(database, user, payload) {
  const group = {
    id: generateId("group"),
    name: payload.name || "Shared group",
    inviteCode: generateInviteCode(),
    createdByUserId: user.id,
    memberUserIds: [user.id],
    pendingMemberNames: uniqueStrings(payload.members || []),
    createdAt: new Date().toISOString(),
  };

  database.groups.unshift(group);
  return hydrateGroup(database, group);
}

function getGroups(database, user) {
  return database.groups
    .filter((group) => group.memberUserIds.includes(user.id))
    .map((group) => hydrateGroup(database, group));
}

function joinGroupByCode(database, user, payload) {
  const code = String(payload.inviteCode || "").trim().toUpperCase();
  const group = database.groups.find((item) => item.inviteCode === code);

  if (!group) {
    return null;
  }

  group.memberUserIds = uniqueStrings([...group.memberUserIds, user.id]);
  group.pendingMemberNames = uniqueStrings((group.pendingMemberNames || []).filter((name) => name !== user.displayName));
  return hydrateGroup(database, group);
}

function addGroupExpense(database, user, groupId, payload) {
  const group = database.groups.find((item) => item.id === groupId);

  if (!group || !group.memberUserIds.includes(user.id)) {
    return null;
  }

  const participants = normalizeParticipantIds(payload.participants, group.memberUserIds);
  const paidByUserId = group.memberUserIds.includes(payload.paidByUserId) ? payload.paidByUserId : user.id;
  const split = buildSplit(payload, participants);
  const expense = {
    id: generateId("expense"),
    title: payload.title || payload.category || "Shared expense",
    amount: Number(payload.amount),
    category: payload.category || "Other",
    date: payload.date || getDateOnly(),
    notes: payload.notes || "",
    type: "shared",
    ownerUserId: user.id,
    groupId,
    paidByUserId,
    split,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  database.expenses.unshift(expense);
  return expense;
}

function hydrateGroup(database, group) {
  return {
    ...group,
    name: group.name === "EDuplex 4" ? "Shared group" : group.name,
    members: group.memberUserIds
      .map((userId) => database.users.find((user) => user.id === userId))
      .filter(Boolean)
      .map((user) => ({ userId: user.id, displayName: user.displayName })),
    sharedExpenses: database.expenses.filter((expense) => expense.groupId === group.id),
  };
}

function buildSplit(payload, participantIds) {
  const amount = Number(payload.amount);
  const splitMode = payload.splitMode === "manual" ? "manual" : "equal";

  if (splitMode === "manual" && Array.isArray(payload.allocations) && payload.allocations.length) {
    return {
      mode: "manual",
      allocations: payload.allocations
        .map((item) => ({
          userId: item.userId,
          amount: Number(item.amount),
        }))
        .filter((item) => item.userId && Number.isFinite(item.amount)),
    };
  }

  const shareAmount = participantIds.length ? Number((amount / participantIds.length).toFixed(2)) : amount;
  return {
    mode: "equal",
    allocations: participantIds.map((userId, index) => {
      if (index === participantIds.length - 1) {
        const previousTotal = shareAmount * (participantIds.length - 1);
        return { userId, amount: Number((amount - previousTotal).toFixed(2)) };
      }

      return { userId, amount: shareAmount };
    }),
  };
}

function normalizeParticipantIds(participants, memberUserIds) {
  const selected = Array.isArray(participants) && participants.length ? participants : memberUserIds;
  return uniqueStrings(selected.filter((userId) => memberUserIds.includes(userId)));
}

function uniqueStrings(items) {
  return [...new Set((items || []).map((item) => String(item).trim()).filter(Boolean))];
}

function generateInviteCode() {
  return Math.random().toString(36).slice(2, 8).toUpperCase();
}

module.exports = {
  addGroupExpense,
  createGroup,
  getGroups,
  joinGroupByCode,
};
