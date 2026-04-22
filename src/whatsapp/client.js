const qrcode = require("qrcode-terminal");
const { Client, LocalAuth } = require("whatsapp-web.js");

function createWhatsAppClient(config, logger) {
  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: config.authPath }),
    puppeteer: {
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    },
  });

  client.on("qr", (qr) => {
    qrcode.generate(qr, { small: true });
    logger.info("WhatsApp QR generated - scan to authenticate");
  });

  client.on("ready", () => logger.info("WhatsApp client ready"));
  client.on("authenticated", () => logger.info("WhatsApp authenticated"));
  client.on("auth_failure", (msg) => logger.error({ msg }, "WhatsApp auth failure"));
  client.on("disconnected", (reason) => logger.warn({ reason }, "WhatsApp disconnected"));

  return client;
}

module.exports = { createWhatsAppClient };
