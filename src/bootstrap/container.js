const { loadConfig } = require("../core/config");
const { createLogger } = require("../core/logger");
const { initializeFirestore } = require("../firebase/client");
const { MappingRepository } = require("../firebase/repositories/mappingRepository");
const { WhatsAppRepository } = require("../firebase/repositories/whatsappRepository");
const { AttendanceRepository } = require("../firebase/repositories/attendanceRepository");
const { PenaltyRepository } = require("../firebase/repositories/penaltyRepository");
const { MappingService } = require("../mapping/mappingService");
const { AttendanceApiService } = require("../attendance-api/service");
const { RulesEngine } = require("../rules-engine/engine");
const { createWhatsAppClient } = require("../whatsapp/client");
const { WhatsAppMessageListener } = require("../whatsapp/messageListener");
const { DoneCache } = require("../whatsapp/doneCache");
const { createDailyAttendanceJob } = require("../scheduler/dailyJob");
const { createApiServer } = require("../api/server");

function buildContainer() {
  const config = loadConfig();
  const logger = createLogger(config.env);
  const db = initializeFirestore(config.firebase);
  const mappingRepository = new MappingRepository(db);
  const whatsappRepository = new WhatsAppRepository(db);
  const attendanceRepository = new AttendanceRepository(db);
  const penaltyRepository = new PenaltyRepository(db);

  const mappingService = new MappingService(mappingRepository);
  const attendanceApiService = new AttendanceApiService(config.attendanceApi, logger);
  const rulesEngine = new RulesEngine({
    mappingService,
    attendanceRepository,
    penaltyRepository,
    logger,
  });
  const doneCache = new DoneCache();
  const healthState = {
    firestoreReady: true,
    whatsappReady: false,
    startTimeMs: Date.now(),
  };

  const whatsappClient = createWhatsAppClient(config.whatsapp, logger);
  whatsappClient.on("ready", () => {
    healthState.whatsappReady = true;
  });
  whatsappClient.on("disconnected", () => {
    healthState.whatsappReady = false;
  });
  whatsappClient.on("auth_failure", () => {
    healthState.whatsappReady = false;
  });
  const whatsappMessageListener = new WhatsAppMessageListener({
    whatsappRepository,
    doneCache,
    groupId: config.whatsapp.groupId,
    logger,
  });

  const api = createApiServer({
    logger,
    attendanceRepository,
    mappingService,
    penaltyRepository,
    whatsappRepository,
    security: config.security,
    healthProvider: () => ({
      env: config.env,
      firestoreReady: healthState.firestoreReady,
      whatsappReady: healthState.whatsappReady,
      uptimeSeconds: Math.floor((Date.now() - healthState.startTimeMs) / 1000),
      timestamp: new Date().toISOString(),
    }),
  });
  const dailyJob = createDailyAttendanceJob({
    cronExpression: config.cron.dailyAttendance,
    timezone: config.timezone,
    attendanceApiService,
    whatsappRepository,
    rulesEngine,
    logger,
  });

  return {
    config,
    logger,
    api,
    dailyJob,
    whatsappClient,
    whatsappMessageListener,
  };
}

module.exports = { buildContainer };
