const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { errorHandler, notFoundHandler } = require("../core/errors");
const { createAttendanceRoutes } = require("./routes/attendanceRoutes");
const { createUserRoutes } = require("./routes/userRoutes");
const { createPenaltyRoutes } = require("./routes/penaltyRoutes");
const { createMappingRoutes } = require("./routes/mappingRoutes");
const { createWhatsAppRoutes } = require("./routes/whatsappRoutes");

function createApiServer({
  logger,
  attendanceRepository,
  mappingService,
  penaltyRepository,
  whatsappRepository,
}) {
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use(
    rateLimit({
      windowMs: 60 * 1000,
      max: 120,
      standardHeaders: true,
      legacyHeaders: false,
    })
  );

  app.get("/health", (req, res) => res.json({ status: "ok" }));
  app.use("/attendance", createAttendanceRoutes({ attendanceRepository }));
  app.use("/users", createUserRoutes({ mappingService }));
  app.use("/penalties", createPenaltyRoutes({ penaltyRepository }));
  app.use("/mapping", createMappingRoutes({ mappingService }));
  app.use("/whatsapp", createWhatsAppRoutes({ whatsappRepository }));
  app.use(notFoundHandler);
  app.use(errorHandler(logger));

  return app;
}

module.exports = { createApiServer };
