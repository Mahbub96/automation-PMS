function normalizeName(item) {
  const direct =
    item?.officialName || item?.name || item?.employee_name || "";
  if (direct) return String(direct).trim();

  const first = String(item?.employee_first_name || "").trim();
  const last = String(item?.employee_last_name || "").trim();
  return `${first} ${last}`.trim();
}

function normalizeRecord(item, status, timestampIso) {
  return {
    employeeId: String(item?.employeeId || item?.employee_id || item?.id || "").trim(),
    officialName: normalizeName(item),
    status: String(status || item?.status || (item?.present ? "PRESENT" : "ABSENT"))
      .toUpperCase()
      .trim(),
    timestamp: String(item?.timestamp || item?.created_at || timestampIso),
    email: String(item?.email || "").trim(),
    phone: String(item?.phone || item?.phone_number || "").trim(),
    workStatus: String(item?.work_status || "").trim(),
    jobPosition: String(item?.job_position || "").trim(),
  };
}

function normalizeTodayDashboardPayload(raw) {
  const nowIso = new Date().toISOString();
  const presentRows = [];
  const absentRows = [];

  const categorized = raw?.categorized;
  if (categorized && typeof categorized === "object" && !Array.isArray(categorized)) {
    Object.values(categorized).forEach((groupItems) => {
      if (!Array.isArray(groupItems)) return;
      groupItems.forEach((item) => {
        presentRows.push(normalizeRecord(item, "PRESENT", nowIso));
      });
    });
  }

  const absentEmployees = Array.isArray(raw?.absent_employees) ? raw.absent_employees : [];
  absentEmployees.forEach((item) => {
    absentRows.push(normalizeRecord(item, "ABSENT", nowIso));
  });

  const unique = new Map();
  [...presentRows, ...absentRows].forEach((row) => {
    if (!row.employeeId) return;
    if (!unique.has(row.employeeId) || row.status === "PRESENT") {
      unique.set(row.employeeId, row);
    }
  });

  return Array.from(unique.values());
}

function normalizeLegacyPayload(raw) {
  const records = Array.isArray(raw?.users) ? raw.users : Array.isArray(raw) ? raw : [];
  const nowIso = new Date().toISOString();
  return records
    .map((item) => normalizeRecord(item, item?.status, nowIso))
    .filter((u) => u.employeeId);
}

function normalizeAttendanceResponse(raw) {
  if (raw && typeof raw === "object" && raw.categorized) {
    return normalizeTodayDashboardPayload(raw);
  }
  return normalizeLegacyPayload(raw);
}

module.exports = { normalizeAttendanceResponse };
