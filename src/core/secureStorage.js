const fs = require("fs/promises");

async function ensurePrivateDirectory(path) {
  await fs.mkdir(path, { recursive: true });
  await fs.chmod(path, 0o700);
}

module.exports = { ensurePrivateDirectory };
