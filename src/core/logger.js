const pino = require("pino");

function createLogger(env) {
  const isDev = env !== "production";
  return pino({
    level: process.env.LOG_LEVEL || "info",
    transport: isDev
      ? {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "SYS:standard" },
        }
      : undefined,
  });
}

module.exports = { createLogger };
