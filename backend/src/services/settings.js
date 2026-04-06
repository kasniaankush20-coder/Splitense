function getSettings(database, user) {
  return {
    userId: user.id,
    userName: user.displayName,
    reportEmail: user.reportEmail || "",
    whatsappNumber: user.whatsappNumber || "",
    emailEnabled: Boolean(user.emailEnabled),
    whatsappEnabled: Boolean(user.whatsappEnabled),
  };
}

function updateSettings(database, user, payload) {
  const target = database.users.find((item) => item.id === user.id);

  if (!target) {
    return getSettings(database, user);
  }

  target.displayName = payload.userName ?? target.displayName;
  target.reportEmail = payload.reportEmail ?? target.reportEmail;
  target.whatsappNumber = payload.whatsappNumber ?? target.whatsappNumber;
  target.emailEnabled = payload.emailEnabled ?? target.emailEnabled;
  target.whatsappEnabled = payload.whatsappEnabled ?? target.whatsappEnabled;

  return getSettings(database, target);
}

module.exports = {
  getSettings,
  updateSettings,
};
