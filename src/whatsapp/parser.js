function parseKeyword(body) {
  const normalized = String(body || "").trim().toLowerCase();
  if (normalized === "done") {
    return "done";
  }
  return null;
}

module.exports = { parseKeyword };
