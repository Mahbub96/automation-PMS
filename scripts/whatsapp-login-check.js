#!/usr/bin/env node
const dotenv = require("dotenv");
const { createWhatsAppClient } = require("../src/whatsapp/client");
const { ensurePrivateDirectory } = require("../src/core/secureStorage");

dotenv.config();

const authPath = process.env.WHATSAPP_AUTH_PATH || ".wwebjs_auth";
const loginTimeoutMs = Number(
  process.env.WHATSAPP_LOGIN_TIMEOUT_MS || 10 * 60 * 1000,
);

const logger = {
  info: (...args) => console.log("[whatsapp-login]", ...args),
  warn: (...args) => console.warn("[whatsapp-login]", ...args),
  error: (...args) => console.error("[whatsapp-login]", ...args),
};

function exitWithError(message) {
  logger.error(message);
  process.exit(1);
}

async function run() {
  if (!process.env.WHATSAPP_GROUP_ID) {
    exitWithError("Missing WHATSAPP_GROUP_ID in .env");
  }

  await ensurePrivateDirectory(authPath);
  const client = createWhatsAppClient({ authPath }, logger);
  let done = false;

  const timeout = setTimeout(async () => {
    if (done) return;
    done = true;
    logger.error(`Login timeout after ${loginTimeoutMs}ms`);
    try {
      await client.destroy();
    } catch (_err) {
      // Ignore cleanup errors on forced timeout.
    }
    process.exit(1);
  }, loginTimeoutMs);

  client.on("ready", async () => {
    if (done) return;
    done = true;
    clearTimeout(timeout);
    logger.info("WhatsApp login successful. Session is ready.");
    try {
      await client.destroy();
    } catch (_err) {
      // Ignore cleanup errors after success.
    }
    process.exit(0);
  });

  client.on("auth_failure", async (msg) => {
    if (done) return;
    done = true;
    clearTimeout(timeout);
    logger.error(`Authentication failed: ${msg || "unknown error"}`);
    try {
      await client.destroy();
    } catch (_err) {
      // Ignore cleanup errors after auth failure.
    }
    process.exit(1);
  });

  client.on("disconnected", (reason) => {
    logger.warn(`Disconnected: ${reason || "unknown reason"}`);
  });

  await client.initialize();
}

run().catch((err) => {
  exitWithError(err?.message || String(err));
});
