function getSettings(database, user) {
  const notifications = Array.isArray(database.reports?.notifications)
    ? database.reports.notifications.filter((entry) => entry.userId === user.id).slice(0, 10)
    : [];

  return {
    userId: user.id,
    userName: user.displayName,
    whatsappNumber: user.whatsappNumber || "",
    whatsappEnabled: Boolean(user.whatsappEnabled),
    lastCommunicationAt: user.lastCommunicationAt || null,
    recentNotifications: notifications,
    customCategoryRules: Array.isArray(user.customCategoryRules) ? user.customCategoryRules : [],
  };
}

function updateSettings(database, user, payload) {
  const target = database.users.find((item) => item.id === user.id);

  if (!target) {
    return getSettings(database, user);
  }

  target.displayName = payload.userName ?? target.displayName;
  target.whatsappNumber = payload.whatsappNumber ?? target.whatsappNumber;
  target.whatsappEnabled = payload.whatsappEnabled ?? target.whatsappEnabled;
  target.reportEmail = "";
  target.emailEnabled = false;

  return getSettings(database, target);
}

module.exports = {
  getSettings,
  updateSettings,
};
