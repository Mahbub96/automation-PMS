#!/usr/bin/env node
const dotenv = require("dotenv");
const fs = require("fs/promises");
const path = require("path");
const http = require("http");
const { createWhatsAppClient } = require("../src/whatsapp/client");
const {
  extractWhatsAppIdentity,
} = require("../src/whatsapp/identityExtractor");
const { parseKeyword } = require("../src/whatsapp/parser");
const { ensurePrivateDirectory } = require("../src/core/secureStorage");
const { dayjs } = require("../src/core/timezone");

dotenv.config();

function normalizePhoneDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function envNumber(value, fallback) {
  const cleaned = String(value ?? "")
    .split("#")[0]
    .trim();
  if (!cleaned) return fallback;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function appendTrackedEvent(cacheFile, event, maxItems = 1000) {
  await fs.mkdir(path.dirname(cacheFile), { recursive: true });
  let items = [];

  try {
    const raw = await fs.readFile(cacheFile, "utf8");
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      items = parsed;
    }
  } catch (_err) {
    // First run or invalid cache file; start fresh.
  }

  items.push(event);
  if (items.length > maxItems) {
    items = items.slice(items.length - maxItems);
  }

  await fs.writeFile(cacheFile, JSON.stringify(items, null, 2));
}

function parseEventTimeMs(event) {
  const raw = event?.timestampLocal || event?.timestampIso || "";
  const parsed = Date.parse(raw);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function filterRecentEvents(items, retentionMs) {
  const threshold = Date.now() - retentionMs;
  return items.filter((item) => {
    const timeMs = parseEventTimeMs(item);
    return timeMs > 0 && timeMs >= threshold;
  });
}

async function pruneTrackedEvents(cacheFile, retentionMs) {
  try {
    const raw = await fs.readFile(cacheFile, "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return;
    }
    const filtered = filterRecentEvents(parsed, retentionMs);
    if (filtered.length !== parsed.length) {
      await fs.writeFile(cacheFile, JSON.stringify(filtered, null, 2));
    }
  } catch (_err) {
    // Ignore missing/invalid cache file.
  }
}

async function run() {
  const groupId = process.env.WHATSAPP_GROUP_ID;
  const authPath = process.env.WHATSAPP_AUTH_PATH || ".wwebjs_auth";
  const timezone = process.env.TIMEZONE || "Asia/Dhaka";
  const cutoffHour = envNumber(
    process.env.WA_DONE_CUTOFF_HOUR ?? process.env.VITE_DONE_CUTOFF_HOUR,
    10,
  );
  const cutoffMinute = envNumber(
    process.env.WA_DONE_CUTOFF_MINUTE ?? process.env.VITE_DONE_CUTOFF_MINUTE,
    25,
  );
  const ssePort = envNumber(process.env.WA_TRACK_SSE_PORT, 3099);
  const retentionHours = envNumber(process.env.WA_TRACK_RETENTION_HOURS, 12);
  const pruneIntervalMs = Number(
    process.env.WA_TRACK_PRUNE_INTERVAL_MS || 10 * 60 * 1000,
  );
  const maxItems = envNumber(process.env.WA_TRACK_MAX_ITEMS, 1000);
  const retentionMs = Math.max(retentionHours, 1) * 60 * 60 * 1000;
  const cacheFile =
    process.env.WA_TRACK_CACHE_FILE ||
    path.resolve("ui", "public", "wa-track-events.json");
  if (!groupId) {
    throw new Error("Missing WHATSAPP_GROUP_ID in .env");
  }

  await ensurePrivateDirectory(authPath);

  const logger = {
    info: (...args) => console.log("[wa-track]", ...args),
    warn: (...args) => console.warn("[wa-track]", ...args),
    error: (...args) => console.error("[wa-track]", ...args),
  };
  const sseClients = new Set();

  const server = http.createServer(async (req, res) => {
    const requestUrl = req.url || "/";
    if (requestUrl.startsWith("/health")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", clients: sseClients.size }));
      return;
    }

    if (requestUrl.startsWith("/events")) {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
      });
      res.write(": connected\n\n");
      sseClients.add(res);
      req.on("close", () => {
        sseClients.delete(res);
      });
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ message: "Not found" }));
  });

  server.listen(ssePort, () => {
    logger.info(`SSE live stream ready at http://localhost:${ssePort}/events`);
  });

  const client = createWhatsAppClient({ authPath }, logger);
  client.on("ready", () => {
    logger.info(`Listener ready. Waiting for 'done' in group ${groupId}...`);
    logger.info(`Caching tracked events to ${cacheFile}`);
    logger.info(`Retention policy: keeping last ${retentionHours} hour(s)`);
    logger.info(`Cache prune interval: ${pruneIntervalMs}ms`);
    logger.info(`Cache max items: ${maxItems}`);
  });

  client.on("message", async (message) => {
    try {
      const isTargetGroup = message.from === groupId;
      const keyword = parseKeyword(message.body);
      const hasDoneKeyword = keyword === "done";
      const bodyPreview = String(message.body || "").slice(0, 120);

      if (!isTargetGroup) return;
      if (!hasDoneKeyword) return;

      const identity = await extractWhatsAppIdentity(message);
      const timestamp = dayjs(
        message.timestamp ? message.timestamp * 1000 : Date.now(),
      )
        .tz(timezone)
        .format("YYYY-MM-DDTHH:mm:ssZ");
      const dateKey = timestamp.slice(0, 10);
      const cutoffLocal = dayjs
        .tz(
          `${dateKey} ${String(cutoffHour).padStart(2, "0")}:${String(cutoffMinute).padStart(2, "0")}:00`,
          "YYYY-MM-DD HH:mm:ss",
          timezone,
        )
        .format("YYYY-MM-DDTHH:mm:ssZ");
      const isLateDone = dayjs(timestamp).isAfter(dayjs(cutoffLocal));
      const trackedEvent = {
        groupId,
        senderId: identity.senderId,
        phone: identity.phone,
        whatsappName: identity.whatsappName,
        message: bodyPreview,
        timestampLocal: timestamp,
        cutoffLocal,
        isLateDone,
      };

      await appendTrackedEvent(cacheFile, trackedEvent, maxItems);
      await pruneTrackedEvents(cacheFile, retentionMs);
      logger.info("TRACKED_DONE_MESSAGE_DETECTED", trackedEvent);
      const ssePayload = `data: ${JSON.stringify(trackedEvent)}\n\n`;
      for (const clientRes of sseClients) {
        clientRes.write(ssePayload);
      }
    } catch (err) {
      logger.error("Listener error:", err?.message || String(err));
    }
  });

  await pruneTrackedEvents(cacheFile, retentionMs);
  setInterval(
    () => {
      pruneTrackedEvents(cacheFile, retentionMs).catch(() => {});
    },
    Math.max(pruneIntervalMs, 1000),
  );
  await client.initialize();
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[wa-track] Fatal error:", err?.message || String(err));
  process.exit(1);
});
