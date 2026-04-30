const path = require("path");
const fs = require("fs");
const dotenv = require("dotenv");
const { APP_TIMEZONE, DAILY_CRON } = require("./constants");

dotenv.config();

const required = [
  "PORT",
  "ATTENDANCE_API_URL",
  "ATTENDANCE_API_KEY",
  "FIREBASE_PROJECT_ID",
  "WHATSAPP_GROUP_ID",
];

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function assertRequiredEnv() {
  const missing = required.filter((key) => !process.env[key]);
  const hasServiceAccountPath = Boolean(
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH,
  );
  const hasPrivateKey =
    Boolean(process.env.FIREBASE_PRIVATE_KEY) ||
    Boolean(process.env.FIREBASE_PRIVATE_KEY_BASE64);

  if (hasServiceAccountPath) {
    if (!fs.existsSync(process.env.FIREBASE_SERVICE_ACCOUNT_PATH)) {
      throw new Error("FIREBASE_SERVICE_ACCOUNT_PATH does not exist.");
    }
  } else {
    if (!process.env.FIREBASE_CLIENT_EMAIL) {
      missing.push("FIREBASE_CLIENT_EMAIL");
    }
    if (!hasPrivateKey) {
      missing.push("FIREBASE_PRIVATE_KEY or FIREBASE_PRIVATE_KEY_BASE64");
    }
  }

  if (missing.length) {
    throw new Error(`Missing required env vars: ${missing.join(", ")}`);
  }

  const port = Number(process.env.PORT || 3000);
  if (!isPositiveInteger(port)) {
    throw new Error("Invalid PORT. Provide a positive integer.");
  }

  const timeoutMs = Number(process.env.ATTENDANCE_TIMEOUT_MS || 10000);
  if (!isPositiveInteger(timeoutMs)) {
    throw new Error(
      "Invalid ATTENDANCE_TIMEOUT_MS. Provide a positive integer.",
    );
  }

  const maxRetries = Number(process.env.ATTENDANCE_MAX_RETRIES || 3);
  if (!isPositiveInteger(maxRetries) && maxRetries !== 0) {
    throw new Error(
      "Invalid ATTENDANCE_MAX_RETRIES. Provide a non-negative integer.",
    );
  }

  const isProduction = (process.env.NODE_ENV || "development") === "production";
  const apiAuthRequired = process.env.API_AUTH_REQUIRED === "true";
  if (apiAuthRequired && !process.env.API_AUTH_TOKEN) {
    throw new Error(
      "Missing API_AUTH_TOKEN. It is required when API_AUTH_REQUIRED=true.",
    );
  }

  if (isProduction && !process.env.WHATSAPP_SESSION_SECRET) {
    throw new Error(
      "Missing WHATSAPP_SESSION_SECRET. It is required in production.",
    );
  }
}

function parseFirebasePrivateKey() {
  if (process.env.FIREBASE_PRIVATE_KEY_BASE64) {
    return Buffer.from(
      process.env.FIREBASE_PRIVATE_KEY_BASE64,
      "base64",
    ).toString("utf8");
  }

  const raw = process.env.FIREBASE_PRIVATE_KEY || "";
  const parsed = raw.replace(/\\n/g, "\n");
  return parsed;
}

function loadConfig() {
  assertRequiredEnv();
  const firebaseServiceAccountPath =
    process.env.FIREBASE_SERVICE_ACCOUNT_PATH || "";

  let firebasePrivateKey = "";
  if (!firebaseServiceAccountPath) {
    firebasePrivateKey = parseFirebasePrivateKey();
    if (
      !firebasePrivateKey.includes("-----BEGIN PRIVATE KEY-----") ||
      !firebasePrivateKey.includes("-----END PRIVATE KEY-----")
    ) {
      throw new Error(
        "Invalid Firebase private key format. Ensure FIREBASE_PRIVATE_KEY uses escaped newlines (\\n), provide FIREBASE_PRIVATE_KEY_BASE64, or use FIREBASE_SERVICE_ACCOUNT_PATH.",
      );
    }
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
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL || "",
      privateKey: firebasePrivateKey,
      serviceAccountPath: firebaseServiceAccountPath,
    },
    whatsapp: {
      groupId: process.env.WHATSAPP_GROUP_ID,
      authPath: process.env.WHATSAPP_AUTH_PATH || path.resolve(".wwebjs_auth"),
      sessionSecret: process.env.WHATSAPP_SESSION_SECRET || "",
    },
    security: {
      apiAuthToken: process.env.API_AUTH_TOKEN || "",
      apiAuthRequired: process.env.API_AUTH_REQUIRED === "true",
    },
  };
}

module.exports = { loadConfig };
