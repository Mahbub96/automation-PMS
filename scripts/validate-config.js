#!/usr/bin/env node
const { loadConfig } = require("../src/core/config");

try {
  const config = loadConfig();
  // eslint-disable-next-line no-console
  console.log(
    `Config valid for env=${config.env}, port=${config.port}, apiAuthRequired=${config.security.apiAuthRequired}`,
  );
  process.exit(0);
} catch (err) {
  // eslint-disable-next-line no-console
  console.error(`Config validation failed: ${err.message}`);
  process.exit(1);
}
