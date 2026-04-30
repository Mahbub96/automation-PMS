const express = require("express");
const path = require("path");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { errorHandler, notFoundHandler } = require("../core/errors");
const { createAttendanceRoutes } = require("./routes/attendanceRoutes");
const { createUserRoutes } = require("./routes/userRoutes");
const { createPenaltyRoutes } = require("./routes/penaltyRoutes");
const { createMappingRoutes } = require("./routes/mappingRoutes");
const { createWhatsAppRoutes } = require("./routes/whatsappRoutes");
const { createApiAuthMiddleware } = require("./authMiddleware");

function createApiServer({
  logger,
  attendanceRepository,
  mappingService,
  penaltyRepository,
  whatsappRepository,
  security = { apiAuthToken: "", apiAuthRequired: false },
  healthProvider = () => ({
    env: process.env.NODE_ENV || "development",
    firestoreReady: true,
    whatsappReady: false,
    uptimeSeconds: Math.floor(process.uptime()),
    timestamp: new Date().toISOString(),
  }),
}) {
  const app = express();
  const uiDistPath = path.resolve("ui", "dist");
  const apiAuthMiddleware = createApiAuthMiddleware({
    token: security.apiAuthToken,
    required: security.apiAuthRequired,
  });
  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      max: 120,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  app.get("/health", (req, res) => {
    const details = healthProvider();
    res.json({
      status: details.whatsappReady ? "ok" : "degraded",
      ...details,
    });
  });
  app.use("/attendance", apiAuthMiddleware, createAttendanceRoutes({ attendanceRepository }));
  app.use("/users", apiAuthMiddleware, createUserRoutes({ mappingService }));
  app.use("/penalties", apiAuthMiddleware, createPenaltyRoutes({ penaltyRepository }));
  app.use("/mapping", apiAuthMiddleware, createMappingRoutes({ mappingService }));
  app.use("/whatsapp", apiAuthMiddleware, createWhatsAppRoutes({ whatsappRepository }));
  app.use("/ui", express.static(uiDistPath));
  app.get("/ui/*splat", (req, res) => {
    res.sendFile(path.join(uiDistPath, "index.html"));
  });
  app.get("/", (req, res) => {
    res.redirect("/ui");
  });
  app.use(notFoundHandler);
  app.use(errorHandler(logger));

  return app;
}

module.exports = { createApiServer };
