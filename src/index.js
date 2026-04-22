const { buildContainer } = require("./bootstrap/container");
const { ensurePrivateDirectory } = require("./core/secureStorage");

async function start() {
  const { api, config, logger, dailyJob, whatsappClient, whatsappMessageListener } = buildContainer();

  await ensurePrivateDirectory(config.whatsapp.authPath);
  whatsappMessageListener.attach(whatsappClient);
  await whatsappClient.initialize();
  dailyJob.start();

  api.listen(config.port, () => {
    logger.info({ port: config.port }, "API server started");
  });
}

start().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Fatal startup error:", err);
  process.exit(1);
});
