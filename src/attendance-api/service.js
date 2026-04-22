const axios = require("axios");
const { normalizeAttendanceResponse } = require("./normalizer");
const { withRetry } = require("./retry");

class AttendanceApiService {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.http = axios.create({
      baseURL: config.url,
      timeout: config.timeoutMs,
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
      },
    });
  }

  async fetchPresentUsers() {
    const data = await withRetry(
      async () => {
        const res = await this.http.get("/");
        return res.data;
      },
      this.config.maxRetries,
      this.logger
    );
    return normalizeAttendanceResponse(data).filter((u) => u.status === "PRESENT");
  }
}

module.exports = { AttendanceApiService };
