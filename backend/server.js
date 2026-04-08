const path = require("path");
const express = require("express");

const { loadEnvFile } = require("./src/services/env");
const { loadDatabase, saveDatabase } = require("./src/services/database");
const { createApiRouter } = require("./src/routes/api");
const { createReportingScheduler, ensureReportsUpToDate } = require("./src/services/reporting");

loadEnvFile();

const app = express();
const port = process.env.PORT || 3000;
const frontendPath = path.join(__dirname, "..", "frontend");

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(frontendPath));

app.locals.database = loadDatabase();
app.locals.saveDatabase = () => saveDatabase(app.locals.database);
app.locals.saveDatabase();

app.use("/api", createApiRouter(app));

app.get("*", (request, response) => {
  response.sendFile(path.join(frontendPath, "index.html"));
});

ensureReportsUpToDate(app);
createReportingScheduler(app);

app.listen(port, () => {
  console.log(`Expense tracker running at http://localhost:${port}`);
});
