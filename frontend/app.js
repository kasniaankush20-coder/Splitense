const sessionStorageKey = "expense-flow-session";

const state = {
  online: false,
  currentUser: null,
  expenses: [],
  groups: [],
  settings: null,
  weeklyReport: null,
  monthlyReport: null,
  selectedGroupId: null,
  editingExpenseId: null,
  activeSection: "main",
  settlementsVisible: false,
};

const elements = {
  connectionStatus: document.getElementById("connectionStatus"),
  tabLinks: Array.from(document.querySelectorAll(".tab-link")),
  sections: {
    main: document.getElementById("section-main"),
    reports: document.getElementById("section-reports"),
    settings: document.getElementById("section-settings"),
  },
  openExpenseButton: document.getElementById("openExpenseButton"),
  closeExpenseButton: document.getElementById("closeExpenseButton"),
  expenseComposer: document.getElementById("expenseComposer"),
  groupTabs: document.getElementById("groupTabs"),
  activeGroupTitle: document.getElementById("activeGroupTitle"),
  groupCodeBadge: document.getElementById("groupCodeBadge"),
  balanceHeadline: document.getElementById("balanceHeadline"),
  balanceSubtext: document.getElementById("balanceSubtext"),
  groupTotal: document.getElementById("groupTotal"),
  groupMeta: document.getElementById("groupMeta"),
  toggleSettlementsButton: document.getElementById("toggleSettlementsButton"),
  exportPdfButton: document.getElementById("exportPdfButton"),
  settlementPanel: document.getElementById("settlementPanel"),
  settlementList: document.getElementById("settlementList"),
  expenseForm: document.getElementById("expenseForm"),
  expenseId: document.getElementById("expenseId"),
  formTitle: document.getElementById("formTitle"),
  title: document.getElementById("title"),
  amount: document.getElementById("amount"),
  date: document.getElementById("date"),
  category: document.getElementById("category"),
  expenseType: document.getElementById("expenseType"),
  sharedFields: document.getElementById("sharedFields"),
  groupId: document.getElementById("groupId"),
  paidBy: document.getElementById("paidBy"),
  participantSelector: document.getElementById("participantSelector"),
  manualSplitField: document.getElementById("manualSplitField"),
  manualSplit: document.getElementById("manualSplit"),
  notes: document.getElementById("notes"),
  cancelEditButton: document.getElementById("cancelEditButton"),
  expenseList: document.getElementById("expenseList"),
  expenseItemTemplate: document.getElementById("expenseItemTemplate"),
  groupForm: document.getElementById("groupForm"),
  groupName: document.getElementById("groupName"),
  groupMembers: document.getElementById("groupMembers"),
  joinGroupForm: document.getElementById("joinGroupForm"),
  inviteCode: document.getElementById("inviteCode"),
  memberName: document.getElementById("memberName"),
  runReportsButton: document.getElementById("runReportsButton"),
  weeklyReportBody: document.getElementById("weeklyReportBody"),
  monthlyReportBody: document.getElementById("monthlyReportBody"),
  settingsForm: document.getElementById("settingsForm"),
  userName: document.getElementById("userName"),
  reportEmail: document.getElementById("reportEmail"),
  whatsappNumber: document.getElementById("whatsappNumber"),
  emailEnabled: document.getElementById("emailEnabled"),
  whatsappEnabled: document.getElementById("whatsappEnabled"),
};

initialize();

async function initialize() {
  elements.date.value = formatDateInput(new Date());
  attachEventListeners();
  await ensureSession();
  await loadAppData();
}

function attachEventListeners() {
  elements.tabLinks.forEach((link) => {
    link.addEventListener("click", () => setActiveSection(link.dataset.section));
  });
  elements.openExpenseButton.addEventListener("click", () => openComposer());
  elements.closeExpenseButton.addEventListener("click", closeComposer);
  elements.expenseForm.addEventListener("submit", handleExpenseSubmit);
  elements.expenseType.addEventListener("change", syncExpenseMode);
  elements.groupId.addEventListener("change", handleComposerGroupChange);
  elements.cancelEditButton.addEventListener("click", resetExpenseForm);
  elements.groupTabs.addEventListener("click", handleGroupTabClick);
  elements.expenseList.addEventListener("click", handleExpenseListActions);
  elements.groupForm.addEventListener("submit", handleGroupCreate);
  elements.joinGroupForm.addEventListener("submit", handleGroupJoin);
  elements.runReportsButton.addEventListener("click", handleRunReports);
  elements.settingsForm.addEventListener("submit", handleSettingsSubmit);
  elements.toggleSettlementsButton.addEventListener("click", toggleSettlements);
  elements.exportPdfButton.addEventListener("click", exportSettlementPdf);
  document.querySelectorAll('input[name="splitType"]').forEach((input) => {
    input.addEventListener("change", syncExpenseMode);
  });
}

async function ensureSession() {
  const savedSession = readSession();

  if (savedSession?.userId) {
    state.currentUser = { id: savedSession.userId, displayName: savedSession.displayName || "You" };
    const sessionUser = await apiRequest("/api/session");
    if (sessionUser) {
      state.currentUser = sessionUser;
      writeSession(sessionUser);
      return;
    }
  }

  let displayName = "";
  while (!displayName) {
    displayName = window.prompt("Enter your name to start using Splitense", savedSession?.displayName || "") || "";
    displayName = displayName.trim();
  }

  const createdUser = await apiRequest("/api/session", {
    method: "POST",
    skipAuth: true,
    body: { displayName },
  });

  if (!createdUser) {
    throw new Error("Unable to create a user session.");
  }

  state.currentUser = createdUser;
  writeSession(createdUser);
}

async function loadAppData() {
  const [health, expenses, groups, settings, weeklyReport, monthlyReport] = await Promise.all([
    apiRequest("/api/health", { skipAuth: true }),
    apiRequest("/api/expenses"),
    apiRequest("/api/groups"),
    apiRequest("/api/settings"),
    apiRequest("/api/reports/weekly/latest"),
    apiRequest("/api/reports/monthly/latest"),
  ]);

  state.online = Boolean(health && health.ok);
  state.expenses = expenses || [];
  state.groups = normalizeGroups(groups || []);
  state.settings = settings || defaultSettings();
  state.weeklyReport = weeklyReport || null;
  state.monthlyReport = monthlyReport || null;
  state.selectedGroupId = state.groups[0]?.id || null;

  syncConnectionStatus();
  fillSettingsForm();
  populateGroupSelect();
  populatePaidBySelect();
  renderParticipantSelector();
  renderAll();
  resetExpenseForm();
}

function setActiveSection(section) {
  state.activeSection = section;
  elements.tabLinks.forEach((link) => {
    link.classList.toggle("active", link.dataset.section === section);
  });
  Object.entries(elements.sections).forEach(([name, element]) => {
    element.classList.toggle("hidden", name !== section);
    element.classList.toggle("active", name === section);
  });
}

function renderAll() {
  renderGroupTabs();
  renderBalanceSummary();
  renderExpenses();
  renderReports();
}

function renderGroupTabs() {
  elements.groupTabs.innerHTML = "";

  if (!state.groups.length) {
    elements.groupTabs.innerHTML = '<div class="empty-state">Create a group or join one by code to get started.</div>';
    return;
  }

  state.groups.forEach((group) => {
    const sharedTotal = sumAmounts(getGroupExpenses(group.id));
    const button = document.createElement("button");
    button.type = "button";
    button.className = `group-tab${group.id === state.selectedGroupId ? " active" : ""}`;
    button.dataset.groupId = group.id;
    button.innerHTML = `<span>${group.name}</span><strong>${formatCurrency(sharedTotal)}</strong>`;
    elements.groupTabs.appendChild(button);
  });
}

function renderBalanceSummary() {
  const selectedGroup = getSelectedGroup();

  if (!selectedGroup) {
    elements.activeGroupTitle.textContent = "Your expenses";
    elements.groupCodeBadge.classList.add("hidden");
    elements.balanceHeadline.textContent = state.currentUser ? `Hello, ${state.currentUser.displayName}` : "All settled up";
    elements.balanceSubtext.textContent = "You only see your personal expenses and groups you belong to.";
    elements.groupTotal.textContent = formatCurrency(sumAmounts(state.expenses.filter((expense) => expense.type === "personal")));
    elements.groupMeta.textContent = `${state.expenses.length} visible expense${state.expenses.length === 1 ? "" : "s"}`;
    elements.settlementList.innerHTML = '<div class="empty-state">Choose a group to see who owes whom.</div>';
    return;
  }

  const groupExpenses = getGroupExpenses(selectedGroup.id);
  const netBalances = calculateNetBalances(selectedGroup, groupExpenses);
  const settlements = buildSettlements(netBalances);
  const userNet = netBalances[state.currentUser.id] || 0;

  elements.activeGroupTitle.textContent = selectedGroup.name;
  elements.groupCodeBadge.textContent = `Code: ${selectedGroup.inviteCode}`;
  elements.groupCodeBadge.classList.remove("hidden");
  elements.groupTotal.textContent = formatCurrency(sumAmounts(groupExpenses));
  elements.groupMeta.textContent = `${selectedGroup.members.length} member${selectedGroup.members.length === 1 ? "" : "s"} • ${groupExpenses.length} visible expense${groupExpenses.length === 1 ? "" : "s"}`;

  if (userNet > 0.009) {
    elements.balanceHeadline.textContent = `You should receive ${formatCurrency(userNet)}`;
    elements.balanceSubtext.textContent = "This group owes you overall.";
  } else if (userNet < -0.009) {
    elements.balanceHeadline.textContent = `You should pay ${formatCurrency(Math.abs(userNet))}`;
    elements.balanceSubtext.textContent = "You owe others in this group.";
  } else {
    elements.balanceHeadline.textContent = "All settled up";
    elements.balanceSubtext.textContent = "You are balanced in this group right now.";
  }

  elements.settlementList.innerHTML = settlements.length
    ? settlements.map((item) => `<article class="settlement-item"><strong>${item.from} pays ${item.to}</strong><p>${formatCurrency(item.amount)}</p></article>`).join("")
    : '<div class="empty-state">Everyone is settled for now.</div>';
}

function renderExpenses() {
  const expenses = getVisibleExpenses();
  elements.expenseList.innerHTML = "";

  if (!expenses.length) {
    elements.expenseList.innerHTML = '<div class="empty-state">No visible expenses yet.</div>';
    return;
  }

  expenses.forEach((expense) => {
    const fragment = elements.expenseItemTemplate.content.cloneNode(true);
    fragment.querySelector(".expense-title").textContent = expense.title;
    fragment.querySelector(".expense-amount").textContent = formatCurrency(expense.amount);
    fragment.querySelector(".expense-meta").textContent = buildExpenseMeta(expense);

    const allocations = fragment.querySelector(".allocation-list");
    if (expense.type === "shared" && expense.split?.allocations?.length) {
      allocations.innerHTML = expense.split.allocations
        .map((item) => `<span class="allocation-chip">${resolveUserName(item.userId, expense.groupId)}: ${formatCurrency(item.amount)}</span>`)
        .join("");
    } else if (expense.notes) {
      allocations.innerHTML = `<span class="allocation-chip">${expense.notes}</span>`;
    }

    fragment.querySelector(".edit-expense").dataset.expenseId = expense.id;
    fragment.querySelector(".delete-expense").dataset.expenseId = expense.id;
    elements.expenseList.appendChild(fragment);
  });
}

function renderReports() {
  elements.weeklyReportBody.textContent = state.weeklyReport?.message || "Weekly summaries will appear here automatically.";
  elements.monthlyReportBody.textContent = state.monthlyReport?.message || "Monthly reports will appear here automatically.";
}

function renderParticipantSelector() {
  const group = state.groups.find((item) => item.id === elements.groupId.value) || getSelectedGroup();
  const members = group?.members || [];
  const selectedExpense = state.editingExpenseId ? state.expenses.find((expense) => expense.id === state.editingExpenseId) : null;
  const selectedUserIds = new Set(selectedExpense?.split?.allocations?.map((item) => item.userId) || members.map((member) => member.userId));

  elements.participantSelector.innerHTML = members.length
    ? members.map((member) => `
        <label class="chip-option ${selectedUserIds.has(member.userId) ? "active" : ""}">
          <input type="checkbox" value="${member.userId}" ${selectedUserIds.has(member.userId) ? "checked" : ""}>
          <span>${member.displayName}</span>
        </label>
      `).join("")
    : '<div class="empty-state">Select a group first.</div>';

  elements.participantSelector.querySelectorAll("input[type='checkbox']").forEach((input) => {
    input.addEventListener("change", () => {
      input.closest(".chip-option")?.classList.toggle("active", input.checked);
    });
  });
}

function syncExpenseMode() {
  const sharedMode = elements.expenseType.value === "shared";
  const manualMode = getSelectedSplitType() === "manual";
  elements.sharedFields.classList.toggle("hidden", !sharedMode);
  elements.manualSplitField.classList.toggle("hidden", !sharedMode || !manualMode);
}

function handleComposerGroupChange() {
  populatePaidBySelect();
  renderParticipantSelector();
}

function handleGroupTabClick(event) {
  const button = event.target.closest("button[data-group-id]");
  if (!button) {
    return;
  }

  state.selectedGroupId = button.dataset.groupId;
  populateGroupSelect();
  populatePaidBySelect();
  renderParticipantSelector();
  renderAll();
}

async function handleExpenseSubmit(event) {
  event.preventDefault();

  const payload = {
    title: elements.title.value.trim(),
    amount: Number(elements.amount.value),
    date: elements.date.value,
    category: elements.category.value,
    notes: elements.notes.value.trim(),
  };

  if (elements.expenseType.value === "shared") {
    const group = state.groups.find((item) => item.id === elements.groupId.value);
    if (!group) {
      window.alert("Choose a group first.");
      return;
    }

    const participants = getSelectedParticipants();
    if (!participants.length) {
      window.alert("Select at least one member to split this expense.");
      return;
    }

    const splitType = getSelectedSplitType();
    const body = {
      ...payload,
      type: "shared",
      groupId: group.id,
      paidByUserId: elements.paidBy.value,
      splitMode: splitType,
      participants,
      allocations: splitType === "manual" ? parseManualAllocations() : [],
      split: buildSplitPayload({ amount: payload.amount, participants, splitMode: splitType, allocations: splitType === "manual" ? parseManualAllocations() : [] }),
    };

    const endpoint = state.editingExpenseId ? `/api/expenses/${state.editingExpenseId}` : `/api/groups/${group.id}/expenses`;
    const method = state.editingExpenseId ? "PUT" : "POST";
    const result = await apiRequest(endpoint, { method, body });
    if (!result) {
      window.alert("Unable to save the shared expense.");
      return;
    }
  } else {
    const endpoint = state.editingExpenseId ? `/api/expenses/${state.editingExpenseId}` : "/api/expenses";
    const method = state.editingExpenseId ? "PUT" : "POST";
    const result = await apiRequest(endpoint, {
      method,
      body: { ...payload, type: "personal" },
    });
    if (!result) {
      window.alert("Unable to save the personal expense.");
      return;
    }
  }

  resetExpenseForm();
  closeComposer();
  await refreshCollections();
}

async function handleExpenseListActions(event) {
  const button = event.target.closest("button[data-expense-id]");
  if (!button) {
    return;
  }

  const expense = state.expenses.find((item) => item.id === button.dataset.expenseId);
  if (!expense) {
    return;
  }

  if (button.classList.contains("delete-expense")) {
    const deleted = await apiRequest(`/api/expenses/${expense.id}`, { method: "DELETE" });
    if (deleted === null) {
      window.alert("You are not allowed to delete this expense.");
      return;
    }
    await refreshCollections();
    return;
  }

  loadExpenseIntoForm(expense);
}

function loadExpenseIntoForm(expense) {
  state.editingExpenseId = expense.id;
  elements.formTitle.textContent = "Edit expense";
  elements.expenseId.value = expense.id;
  elements.title.value = expense.title || "";
  elements.amount.value = expense.amount;
  elements.date.value = expense.date;
  elements.category.value = expense.category || "Other";
  elements.notes.value = expense.notes || "";
  elements.expenseType.value = expense.type || "personal";
  elements.groupId.value = expense.groupId || state.selectedGroupId || "";
  populatePaidBySelect();
  if (expense.paidByUserId) {
    elements.paidBy.value = expense.paidByUserId;
  }
  setSplitType(expense.split?.mode || "equal");
  elements.manualSplit.value = expense.split?.allocations?.length
    ? expense.split.allocations.map((item) => `${resolveUserName(item.userId, expense.groupId)}: ${item.amount}`).join("\n")
    : "";
  renderParticipantSelector();
  elements.cancelEditButton.classList.remove("hidden");
  syncExpenseMode();
  openComposer();
}

function resetExpenseForm() {
  state.editingExpenseId = null;
  elements.formTitle.textContent = "Add an expense";
  elements.expenseForm.reset();
  elements.date.value = formatDateInput(new Date());
  elements.expenseType.value = state.selectedGroupId ? "shared" : "personal";
  elements.groupId.value = state.selectedGroupId || elements.groupId.value;
  setSplitType("equal");
  elements.manualSplit.value = "";
  elements.cancelEditButton.classList.add("hidden");
  populatePaidBySelect();
  renderParticipantSelector();
  syncExpenseMode();
}

function openComposer() {
  elements.expenseComposer.classList.remove("hidden");
}

function closeComposer() {
  elements.expenseComposer.classList.add("hidden");
}

async function handleGroupCreate(event) {
  event.preventDefault();
  const result = await apiRequest("/api/groups", {
    method: "POST",
    body: {
      name: elements.groupName.value.trim(),
      members: elements.groupMembers.value.split(",").map((value) => value.trim()).filter(Boolean),
    },
  });

  if (!result) {
    window.alert("Unable to create group.");
    return;
  }

  elements.groupForm.reset();
  await refreshCollections();
}

async function handleGroupJoin(event) {
  event.preventDefault();
  const result = await apiRequest("/api/groups/join", {
    method: "POST",
    body: {
      inviteCode: elements.inviteCode.value.trim(),
      memberName: currentUserName(),
    },
  });

  if (!result) {
    window.alert("Group code not found.");
    return;
  }

  elements.joinGroupForm.reset();
  await refreshCollections();
}

async function handleRunReports() {
  const result = await apiRequest("/api/reports/run", { method: "POST", body: {} });
  if (result) {
    state.weeklyReport = result.weeklyReport;
    state.monthlyReport = result.monthlyReport;
    renderReports();
    setActiveSection("reports");
  }
}

async function handleSettingsSubmit(event) {
  event.preventDefault();
  const result = await apiRequest("/api/settings", {
    method: "PUT",
    body: {
      userName: elements.userName.value.trim() || currentUserName(),
      reportEmail: elements.reportEmail.value.trim(),
      whatsappNumber: elements.whatsappNumber.value.trim(),
      emailEnabled: elements.emailEnabled.checked,
      whatsappEnabled: elements.whatsappEnabled.checked,
    },
  });

  if (!result) {
    window.alert("Unable to save settings.");
    return;
  }

  state.settings = result;
  state.currentUser.displayName = result.userName;
  writeSession(state.currentUser);
  await refreshCollections();
}

async function refreshCollections() {
  const [expenses, groups, settings, weeklyReport, monthlyReport] = await Promise.all([
    apiRequest("/api/expenses"),
    apiRequest("/api/groups"),
    apiRequest("/api/settings"),
    apiRequest("/api/reports/weekly/latest"),
    apiRequest("/api/reports/monthly/latest"),
  ]);

  state.expenses = expenses || [];
  state.groups = normalizeGroups(groups || []);
  state.settings = settings || state.settings;
  state.weeklyReport = weeklyReport || state.weeklyReport;
  state.monthlyReport = monthlyReport || state.monthlyReport;

  if (!state.groups.some((group) => group.id === state.selectedGroupId)) {
    state.selectedGroupId = state.groups[0]?.id || null;
  }

  populateGroupSelect();
  populatePaidBySelect();
  renderParticipantSelector();
  fillSettingsForm();
  renderAll();
}

function populateGroupSelect() {
  elements.groupId.innerHTML = state.groups.length
    ? state.groups.map((group) => `<option value="${group.id}">${group.name}</option>`).join("")
    : '<option value="">No groups yet</option>';

  if (state.selectedGroupId) {
    elements.groupId.value = state.selectedGroupId;
  }
}

function populatePaidBySelect() {
  const group = state.groups.find((item) => item.id === elements.groupId.value) || getSelectedGroup();
  const members = group?.members?.length ? group.members : [{ userId: state.currentUser.id, displayName: state.currentUser.displayName }];
  elements.paidBy.innerHTML = members.map((member) => `<option value="${member.userId}">${member.displayName}</option>`).join("");
  elements.paidBy.value = members.some((member) => member.userId === state.currentUser.id) ? state.currentUser.id : members[0].userId;
}

function fillSettingsForm() {
  const settings = state.settings || defaultSettings();
  elements.userName.value = settings.userName || state.currentUser?.displayName || "";
  elements.reportEmail.value = settings.reportEmail || "";
  elements.whatsappNumber.value = settings.whatsappNumber || "";
  elements.emailEnabled.checked = Boolean(settings.emailEnabled);
  elements.whatsappEnabled.checked = Boolean(settings.whatsappEnabled);
}

function syncConnectionStatus() {
  elements.connectionStatus.textContent = state.online ? `Connected as ${currentUserName()}` : `Offline: ${currentUserName()}`;
  elements.connectionStatus.classList.toggle("online", state.online);
  elements.connectionStatus.classList.toggle("offline", !state.online);
}

function getSelectedGroup() {
  return state.groups.find((group) => group.id === state.selectedGroupId) || null;
}

function getVisibleExpenses() {
  const selectedGroup = getSelectedGroup();
  const source = selectedGroup
    ? getGroupExpenses(selectedGroup.id)
    : state.expenses.slice().sort((a, b) => sortByMostRecent(a, b));
  return source.slice(0, 24);
}

function getGroupExpenses(groupId) {
  return state.expenses
    .filter((expense) => expense.type === "shared" && expense.groupId === groupId)
    .sort((a, b) => sortByMostRecent(a, b));
}

function getSelectedParticipants() {
  return Array.from(elements.participantSelector.querySelectorAll("input[type='checkbox']:checked")).map((input) => input.value);
}

function buildExpenseMeta(expense) {
  const parts = [formatHumanDate(expense.date), expense.category];
  parts.push(expense.type === "shared" ? `Paid by ${resolveUserName(expense.paidByUserId, expense.groupId)}` : "Personal only");
  return parts.join(" • ");
}

function resolveUserName(userId, groupId) {
  if (state.currentUser?.id === userId) {
    return state.currentUser.displayName;
  }
  const group = state.groups.find((item) => item.id === groupId);
  const member = group?.members?.find((item) => item.userId === userId);
  return member?.displayName || "Unknown";
}

function calculateNetBalances(group, expenses) {
  const balances = {};
  group.members.forEach((member) => {
    balances[member.userId] = 0;
  });

  expenses.forEach((expense) => {
    balances[expense.paidByUserId] = (balances[expense.paidByUserId] || 0) + Number(expense.amount || 0);
    (expense.split?.allocations || []).forEach((allocation) => {
      balances[allocation.userId] = (balances[allocation.userId] || 0) - Number(allocation.amount || 0);
    });
  });

  return balances;
}

function buildSettlements(netBalances) {
  const debtors = [];
  const creditors = [];

  Object.entries(netBalances).forEach(([userId, amount]) => {
    if (amount > 0.009) {
      creditors.push({ userId, amount });
    } else if (amount < -0.009) {
      debtors.push({ userId, amount: Math.abs(amount) });
    }
  });

  const settlements = [];
  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const amount = Math.min(debtor.amount, creditor.amount);
    settlements.push({ from: resolveUserName(debtor.userId, state.selectedGroupId), to: resolveUserName(creditor.userId, state.selectedGroupId), amount });
    debtor.amount = roundCurrency(debtor.amount - amount);
    creditor.amount = roundCurrency(creditor.amount - amount);
    if (debtor.amount <= 0.009) {
      debtorIndex += 1;
    }
    if (creditor.amount <= 0.009) {
      creditorIndex += 1;
    }
  }

  return settlements;
}

function toggleSettlements() {
  state.settlementsVisible = !state.settlementsVisible;
  elements.settlementPanel.classList.toggle("hidden", !state.settlementsVisible);
  elements.toggleSettlementsButton.textContent = state.settlementsVisible ? "Hide settle up" : "Show settle up";
}

function exportSettlementPdf() {
  const group = getSelectedGroup();
  if (!group) {
    window.alert("Select a group first.");
    return;
  }

  const settlements = buildSettlements(calculateNetBalances(group, getGroupExpenses(group.id)));
  const popup = window.open("", "_blank");
  if (!popup) {
    window.alert("Please allow popups to export the PDF.");
    return;
  }

  popup.document.write(`
    <html>
      <head><title>${group.name} settlement</title></head>
      <body style="font-family: Arial, sans-serif; padding: 24px; color: #1f1d1a;">
        <h1>${group.name}</h1>
        <p>Invite code: ${group.inviteCode}</p>
        <p>Generated for ${currentUserName()} on ${new Date().toLocaleString("en-IN")}</p>
        ${settlements.length
          ? settlements.map((item) => `<div style="border:1px solid #ddd;border-radius:12px;padding:12px 14px;margin:12px 0;"><strong>${item.from} pays ${item.to}</strong><div>${formatCurrency(item.amount)}</div></div>`).join("")
          : "<p>Everyone is settled.</p>"}
      </body>
    </html>
  `);
  popup.document.close();
  popup.focus();
  popup.print();
}

function buildSplitPayload(payload) {
  if (payload.splitMode === "manual" && payload.allocations.length) {
    return { mode: "manual", allocations: payload.allocations };
  }

  const participants = payload.participants || [];
  const share = participants.length ? Number((Number(payload.amount) / participants.length).toFixed(2)) : Number(payload.amount);
  return {
    mode: "equal",
    allocations: participants.map((userId, index) => {
      if (index === participants.length - 1) {
        return { userId, amount: Number((Number(payload.amount) - share * (participants.length - 1)).toFixed(2)) };
      }
      return { userId, amount: share };
    }),
  };
}

function parseManualAllocations() {
  const group = getSelectedGroup() || state.groups.find((item) => item.id === elements.groupId.value);
  const nameToUserId = new Map((group?.members || []).map((member) => [member.displayName, member.userId]));

  return elements.manualSplit.value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [name, amount] = line.split(":");
      return {
        userId: nameToUserId.get((name || "").trim()),
        amount: Number((amount || "").trim()),
      };
    })
    .filter((item) => item.userId && Number.isFinite(item.amount));
}

function getSelectedSplitType() {
  return document.querySelector('input[name="splitType"]:checked')?.value || "equal";
}

function setSplitType(value) {
  const target = document.querySelector(`input[name="splitType"][value="${value}"]`);
  if (target) {
    target.checked = true;
  }
}

async function apiRequest(url, options = {}) {
  try {
    const headers = { "Content-Type": "application/json" };
    if (!options.skipAuth && state.currentUser?.id) {
      headers["x-user-id"] = state.currentUser.id;
    }

    const response = await fetch(url, {
      method: options.method || "GET",
      headers,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    if (!response.ok) {
      throw new Error(`Request failed: ${response.status}`);
    }

    if (response.status === 204) {
      return {};
    }

    return await response.json();
  } catch (error) {
    console.warn(`API request failed for ${url}`, error);
    return null;
  }
}

function readSession() {
  try {
    return JSON.parse(window.localStorage.getItem(sessionStorageKey));
  } catch (error) {
    return null;
  }
}

function writeSession(user) {
  window.localStorage.setItem(sessionStorageKey, JSON.stringify({ userId: user.id, displayName: user.displayName }));
}

function normalizeGroups(groups) {
  return (groups || []).map((group) => ({
    ...group,
    members: group.members || [],
    sharedExpenses: group.sharedExpenses || [],
  }));
}

function defaultSettings() {
  return {
    userName: state.currentUser?.displayName || "You",
    reportEmail: "",
    whatsappNumber: "",
    emailEnabled: false,
    whatsappEnabled: false,
  };
}

function currentUserName() {
  return state.settings?.userName || state.currentUser?.displayName || "You";
}

function sumAmounts(items) {
  return items.reduce((total, item) => total + Number(item.amount || 0), 0);
}

function sortByMostRecent(first, second) {
  return new Date(second.date) - new Date(first.date) || new Date(second.createdAt || 0) - new Date(first.createdAt || 0);
}

function formatCurrency(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
  }).format(Number(value || 0));
}

function formatDateInput(date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatHumanDate(value) {
  return new Date(`${value}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function roundCurrency(value) {
  return Number(value.toFixed(2));
}

