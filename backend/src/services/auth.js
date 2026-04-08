const { generateId } = require("./utils");

function getRequestUser(database, request) {
  const userId = request.header("x-user-id");

  if (!userId) {
    return null;
  }

  return database.users.find((user) => user.id === userId) || null;
}

function requireAuthenticatedUser(app) {
  return (request, response, next) => {
    const user = getRequestUser(app.locals.database, request);

    if (!user) {
      response.status(401).json({ message: "Authentication required" });
      return;
    }

    request.currentUser = user;
    next();
  };
}

function createSession(database, payload) {
  const displayName = String(payload.displayName || "").trim();

  if (!displayName) {
    return null;
  }

  const user = {
    id: generateId("user"),
    displayName,
    reportEmail: "",
    whatsappNumber: "",
    emailEnabled: false,
    whatsappEnabled: false,
    lastCommunicationAt: null,
    customCategoryRules: [],
    createdAt: new Date().toISOString(),
  };

  database.users.unshift(user);
  return user;
}

module.exports = {
  createSession,
  getRequestUser,
  requireAuthenticatedUser,
};
