const { parseKeyword } = require("./parser");
const { extractWhatsAppIdentity } = require("./identityExtractor");
const { dateKeyDhaka, dayjs } = require("../core/timezone");

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
        if (message.from !== this.groupId) {
          return;
        }

        const keyword = parseKeyword(message.body);
        if (!keyword) {
          return;
        }

        const identity = await extractWhatsAppIdentity(message);
        const now = dayjs(message.timestamp ? message.timestamp * 1000 : Date.now());
        const payload = {
          ...identity,
          keyword,
          message: message.body,
          timestampIso: now.toISOString(),
          date: dateKeyDhaka(now.toISOString()),
        };

        if (this.doneCache.has(payload)) {
          return;
        }

        await this.whatsappRepository.upsertDoneMessage(payload);
        this.doneCache.add(payload);
        this.logger.info({ payload }, "Stored WhatsApp done message");
      } catch (err) {
        this.logger.error({ err: err.message }, "Failed to process WhatsApp message");
      }
    });
  }
}

module.exports = { WhatsAppMessageListener };
