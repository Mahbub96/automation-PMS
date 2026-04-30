const { buildContainer } = require("./bootstrap/container");
const { ensurePrivateDirectory } = require("./core/secureStorage");

function registerProcessErrorHandlers(logger) {
  process.on("unhandledRejection", (reason) => {
    logger.error({ err: reason }, "Unhandled promise rejection captured");
  });

  process.on("uncaughtException", (err) => {
    logger.error({ err }, "Uncaught exception captured");
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function start() {
  const {
    api,
    config,
    logger,
    dailyJob,
    whatsappClient,
    whatsappMessageListener,
  } = buildContainer();
  registerProcessErrorHandlers(logger);

  api.listen(config.port, () => {
    logger.info({ port: config.port }, "API server started");
  });

  try {
    await ensurePrivateDirectory(config.whatsapp.authPath);
    whatsappMessageListener.attach(whatsappClient);
    await whatsappClient.initialize();
  } catch (err) {
    logger.error(
      { err },
      "WhatsApp initialization failed. API remains available.",
    );
  }

  try {
    dailyJob.start();
  } catch (err) {
    logger.error({ err }, "Scheduler startup failed. API remains available.");
  }
}

async function startWithRetry() {
  const retryDelayMs = Number(process.env.STARTUP_RETRY_MS || 5000);
  const env = process.env.NODE_ENV || "development";
  const retryEnabled = process.env.STARTUP_RETRY_ENABLED
    ? process.env.STARTUP_RETRY_ENABLED === "true"
    : env !== "production";

  // In production, fail fast by default so process managers can handle restart policy.
  if (!retryEnabled) {
    await start();
    return;
  }

  // In development, retry to reduce disruption while fixing environment/runtime setup issues.
  while (true) {
    try {
      await start();
      return;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("Startup failed. Retrying...", err);
      await sleep(retryDelayMs);
    }
  }
}

startWithRetry().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Fatal startup loop error:", err);
});
