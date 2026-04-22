function normalizeAttendanceResponse(raw) {
  const records = Array.isArray(raw?.users) ? raw.users : Array.isArray(raw) ? raw : [];

  return records
    .map((item) => ({
      employeeId: String(item.employeeId || item.id || "").trim(),
      officialName: String(item.officialName || item.name || "").trim(),
      status: String(item.status || (item.present ? "PRESENT" : "ABSENT") || "ABSENT").toUpperCase(),
      timestamp: item.timestamp || new Date().toISOString(),
    }))
    .filter((u) => u.employeeId);
}

module.exports = { normalizeAttendanceResponse };
