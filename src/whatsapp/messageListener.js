const { parseKeyword } = require("./parser");
const { extractWhatsAppIdentity } = require("./identityExtractor");
const { dateKeyDhaka, dayjs } = require("../core/timezone");

function normalizePhoneDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function isTrackedDoneSender(phone) {
  const digits = normalizePhoneDigits(phone);
  if (!digits) {
    return false;
  }
  // Supports local/country-code representations of 01784310996.
  return digits.endsWith("01784310996") || digits.endsWith("1784310996");
}

class WhatsAppMessageListener {
  constructor({ whatsappRepository, doneCache, groupId, logger }) {
    this.whatsappRepository = whatsappRepository;
    this.doneCache = doneCache;
    this.groupId = groupId;
    this.logger = logger;
  }

  attach(client) {
    client.on("message", async (message) => {
      try {
        this.logger.debug(
          {
            from: message.from,
            author: message.author || null,
            hasMedia: Boolean(message.hasMedia),
            timestamp: message.timestamp || null,
            bodyPreview: (message.body || "").slice(0, 120),
          },
          "Received WhatsApp message event",
        );

        if (message.from !== this.groupId) {
          return;
        }

        const keyword = parseKeyword(message.body);
        if (!keyword) {
          this.logger.debug(
            { bodyPreview: (message.body || "").slice(0, 120) },
            "Ignored WhatsApp message without supported keyword",
          );
          return;
        }

        const identity = await extractWhatsAppIdentity(message);
        const now = dayjs(
          message.timestamp ? message.timestamp * 1000 : Date.now(),
        );
        const payload = {
          ...identity,
          keyword,
          message: message.body,
          timestampIso: now.toISOString(),
          date: dateKeyDhaka(now.toISOString()),
        };

        if (this.doneCache.has(payload)) {
          this.logger.debug(
            { senderId: payload.senderId, date: payload.date },
            "Ignored duplicate WhatsApp done message",
          );
          return;
        }

        const docId = await this.whatsappRepository.upsertDoneMessage(payload);
        this.doneCache.add(payload);
        this.logger.info(
          {
            docId,
            senderId: payload.senderId,
            whatsappName: payload.whatsappName,
            phone: payload.phone,
            keyword: payload.keyword,
            date: payload.date,
            timestampIso: payload.timestampIso,
            message: payload.message,
          },
          "Stored WhatsApp done message",
        );

        if (
          payload.keyword === "done" &&
          isTrackedDoneSender(payload.phone || payload.senderId)
        ) {
          this.logger.info(
            {
              trackedNumber: "01784310996",
              senderId: payload.senderId,
              phone: payload.phone,
              message: payload.message,
              timestampIso: payload.timestampIso,
            },
            "TRACKED_DONE_MESSAGE_DETECTED",
          );
        }
      } catch (err) {
        this.logger.error(
          { err: err.message },
          "Failed to process WhatsApp message",
        );
      }
    });
  }
}

module.exports = { WhatsAppMessageListener };
