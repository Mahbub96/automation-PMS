function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(fn, maxRetries, logger) {
  let error = null;
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      error = err;
      logger.warn({ attempt, err: err.message }, "Attendance API call failed");
      if (attempt < maxRetries) {
        await sleep(500 * attempt);
      }
    }
  }
  throw error;
}

module.exports = { withRetry };
