const axios = require("axios");
const fs = require("fs/promises");
const path = require("path");
const { normalizeAttendanceResponse } = require("./normalizer");
const { withRetry } = require("./retry");

function decodeJwtExpMs(token) {
  try {
    const payloadSegment = String(token || "").split(".")[1];
    if (!payloadSegment) return 0;
    const json = Buffer.from(payloadSegment, "base64url").toString("utf8");
    const payload = JSON.parse(json);
    const expSeconds = Number(payload.exp || 0);
    return Number.isFinite(expSeconds) && expSeconds > 0 ? expSeconds * 1000 : 0;
  } catch (_error) {
    return 0;
  }
}

function deriveAuthUrl(config) {
  if (config.authUrl) return config.authUrl;
  try {
    const base = new URL(config.url);
    return `${base.origin}/api/auth/login/`;
  } catch (_error) {
    return "";
  }
}

class AttendanceApiService {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.cachedToken = "";
    this.cachedTokenExpMs = 0;
    this.authUrl = deriveAuthUrl(config);
    this.http = axios.create({
      baseURL: config.url,
      timeout: config.timeoutMs,
    });
  }

  hasStaticApiKey() {
    return Boolean(this.config.apiKey);
  }

  hasLoginCredentials() {
    return Boolean(this.authUrl && this.config.username && this.config.password);
  }

  isTokenValid() {
    if (!this.cachedToken) return false;
    if (!this.cachedTokenExpMs) return true;
    return Date.now() + 10 * 1000 < this.cachedTokenExpMs;
  }

  async loadTokenFromCacheFile() {
    const filePath = this.config.tokenCacheFile;
    if (!filePath) return;
    try {
      const raw = await fs.readFile(filePath, "utf8");
      const data = JSON.parse(raw);
      const token = String(data?.access || "").trim();
      if (!token) return;
      const expMs = Number(data?.expiresAtMs || decodeJwtExpMs(token) || 0);
      if (expMs && Date.now() >= expMs) return;
      this.cachedToken = token;
      this.cachedTokenExpMs = expMs;
      this.logger.info("Loaded attendance access token from cache.");
    } catch (_error) {
      // Ignore cache miss/parse errors and continue with fresh login.
    }
  }

  async persistTokenToCacheFile(token, expMs) {
    const filePath = this.config.tokenCacheFile;
    if (!filePath) return;
    try {
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(
        filePath,
        JSON.stringify(
          {
            access: token,
            expiresAtMs: expMs || 0,
            updatedAt: new Date().toISOString(),
          },
          null,
          2,
        ),
      );
    } catch (_error) {
      this.logger.warn("Failed to persist attendance access token cache.");
    }
  }

  async loginAndCacheToken() {
    if (!this.hasLoginCredentials()) {
      throw new Error(
        "Attendance login is not configured. Set ATTENDANCE_AUTH_URL (or a valid ATTENDANCE_API_URL origin), ATTENDANCE_USERNAME, and ATTENDANCE_PASSWORD.",
      );
    }
    const res = await axios.post(
      this.authUrl,
      {
        username: this.config.username,
        password: this.config.password,
      },
      { timeout: this.config.timeoutMs },
    );
    const token = String(res?.data?.access || "").trim();
    if (!token) {
      throw new Error("Attendance login succeeded but no access token was returned.");
    }
    const expMs = decodeJwtExpMs(token);
    this.cachedToken = token;
    this.cachedTokenExpMs = expMs;
    await this.persistTokenToCacheFile(token, expMs);
    this.logger.info("Attendance access token refreshed via login.");
    return token;
  }

  async getBearerToken() {
    if (this.hasStaticApiKey()) {
      return this.config.apiKey;
    }
    if (this.isTokenValid()) {
      return this.cachedToken;
    }
    await this.loadTokenFromCacheFile();
    if (this.isTokenValid()) {
      return this.cachedToken;
    }
    return this.loginAndCacheToken();
  }

  invalidateTokenCache() {
    this.cachedToken = "";
    this.cachedTokenExpMs = 0;
  }

  async fetchPresentUsers() {
    const data = await withRetry(
      async () => {
        const token = await this.getBearerToken();
        try {
          const res = await this.http.get(this.config.todayPath || "/", {
            headers: { Authorization: `Bearer ${token}` },
          });
          return res.data;
        } catch (error) {
          if (!this.hasStaticApiKey() && error?.response?.status === 401) {
            this.invalidateTokenCache();
            const retryToken = await this.getBearerToken();
            const retryRes = await this.http.get(this.config.todayPath || "/", {
              headers: { Authorization: `Bearer ${retryToken}` },
            });
            return retryRes.data;
          }
          throw error;
        }
      },
      this.config.maxRetries,
      this.logger,
    );
    return normalizeAttendanceResponse(data).filter((u) => u.status === "PRESENT");
  }
}

module.exports = { AttendanceApiService };
