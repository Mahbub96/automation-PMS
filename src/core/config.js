const path = require("path");
const dotenv = require("dotenv");
const { APP_TIMEZONE, DAILY_CRON } = require("./constants");

dotenv.config();

const required = [
  "PORT",
  "ATTENDANCE_API_URL",
  "ATTENDANCE_API_KEY",
  "FIREBASE_PROJECT_ID",
  "FIREBASE_CLIENT_EMAIL",
  "WHATSAPP_GROUP_ID",
];

function assertRequiredEnv() {
  const missing = required.filter((key) => !process.env[key]);
  const hasPrivateKey =
    Boolean(process.env.FIREBASE_PRIVATE_KEY) || Boolean(process.env.FIREBASE_PRIVATE_KEY_BASE64);

  if (!hasPrivateKey) {
    missing.push("FIREBASE_PRIVATE_KEY or FIREBASE_PRIVATE_KEY_BASE64");
  }

  if (missing.length) {
    throw new Error(`Missing required env vars: ${missing.join(", ")}`);
  }
}

function parseFirebasePrivateKey() {
  if (process.env.FIREBASE_PRIVATE_KEY_BASE64) {
    return Buffer.from(process.env.FIREBASE_PRIVATE_KEY_BASE64, "base64").toString("utf8");
  }

  const raw = process.env.FIREBASE_PRIVATE_KEY || "";
  const parsed = raw.replace(/\\n/g, "\n");
  return parsed;
}

function loadConfig() {
  assertRequiredEnv();

  const firebasePrivateKey = parseFirebasePrivateKey();
  if (
    !firebasePrivateKey.includes("-----BEGIN PRIVATE KEY-----") ||
    !firebasePrivateKey.includes("-----END PRIVATE KEY-----")
  ) {
    throw new Error(
      "Invalid Firebase private key format. Ensure FIREBASE_PRIVATE_KEY uses escaped newlines (\\n) or provide FIREBASE_PRIVATE_KEY_BASE64."
    );
  }

  return {
    env: process.env.NODE_ENV || "development",
    port: Number(process.env.PORT || 3000),
    timezone: process.env.TIMEZONE || APP_TIMEZONE,
    cron: {
      dailyAttendance: process.env.DAILY_CRON || DAILY_CRON,
    },
    attendanceApi: {
      url: process.env.ATTENDANCE_API_URL,
      apiKey: process.env.ATTENDANCE_API_KEY,
      timeoutMs: Number(process.env.ATTENDANCE_TIMEOUT_MS || 10000),
      maxRetries: Number(process.env.ATTENDANCE_MAX_RETRIES || 3),
    },
    firebase: {
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: firebasePrivateKey,
    },
    whatsapp: {
      groupId: process.env.WHATSAPP_GROUP_ID,
      authPath: process.env.WHATSAPP_AUTH_PATH || path.resolve(".wwebjs_auth"),
      sessionSecret: process.env.WHATSAPP_SESSION_SECRET || "",
    },
  };
}

module.exports = { loadConfig };
