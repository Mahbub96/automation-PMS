#!/usr/bin/env node
const fs = require("fs/promises");
const path = require("path");
const axios = require("axios");
const dotenv = require("dotenv");

dotenv.config();

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function extractName(item) {
  const direct = item?.name || item?.officialName || item?.employee_name || "";
  if (direct) return String(direct).trim();
  const first = String(item?.employee_first_name || "").trim();
  const last = String(item?.employee_last_name || "").trim();
  return `${first} ${last}`.trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

async function readJsonIfExists(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (_error) {
    return fallback;
  }
}

async function getToken() {
  const authUrl = process.env.ATTENDANCE_AUTH_URL || "";
  const username = process.env.ATTENDANCE_USERNAME || "";
  const password = process.env.ATTENDANCE_PASSWORD || "";
  const staticToken = process.env.ATTENDANCE_API_KEY || "";

  if (staticToken) return staticToken;
  if (!authUrl || !username || !password) {
    throw new Error(
      "Missing ATTENDANCE auth configuration. Set ATTENDANCE_AUTH_URL, ATTENDANCE_USERNAME, ATTENDANCE_PASSWORD (or ATTENDANCE_API_KEY).",
    );
  }

  const res = await axios.post(
    authUrl,
    { username, password },
    { timeout: Number(process.env.ATTENDANCE_TIMEOUT_MS || 10000) },
  );
  const token = String(res?.data?.access || "").trim();
  if (!token) {
    throw new Error("Attendance login response has no access token.");
  }
  return token;
}

async function getTodayDashboard(token) {
  const baseUrl = (process.env.ATTENDANCE_API_URL || "").replace(/\/$/, "");
  const todayPath =
    process.env.ATTENDANCE_API_TODAY_PATH || "/api/brotecs/today-dashboard";
  if (!baseUrl) {
    throw new Error("Missing ATTENDANCE_API_URL");
  }
  const url = `${baseUrl}${todayPath.startsWith("/") ? todayPath : `/${todayPath}`}`;
  const res = await axios.get(url, {
    timeout: Number(process.env.ATTENDANCE_TIMEOUT_MS || 10000),
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
  return res.data || {};
}

function buildAttendanceRows(payload) {
  const rows = [];
  const categorized = payload?.categorized;
  if (
    categorized &&
    typeof categorized === "object" &&
    !Array.isArray(categorized)
  ) {
    Object.values(categorized).forEach((items) => {
      asArray(items).forEach((item) => {
        rows.push({
          attendanceName: extractName(item),
          email: String(item?.email || "").trim(),
          phone: String(item?.phone || item?.phone_number || "").trim(),
        });
      });
    });
  }
  asArray(payload?.absent_employees).forEach((item) => {
    rows.push({
      attendanceName: extractName(item),
      email: String(item?.email || "").trim(),
      phone: String(item?.phone || item?.phone_number || "").trim(),
    });
  });
  return rows.filter((row) => row.attendanceName);
}

function digits(value) {
  return String(value || "").replace(/\D/g, "");
}

function resolvePmsName(attendanceRow, employees) {
  const byEmail = employees.find(
    (e) =>
      String(e?.email || "")
        .trim()
        .toLowerCase() &&
      String(e?.email || "")
        .trim()
        .toLowerCase() ===
        String(attendanceRow.email || "")
          .trim()
          .toLowerCase(),
  );
  if (byEmail?.name) return String(byEmail.name).trim();

  const attendancePhone = digits(attendanceRow.phone);
  if (attendancePhone) {
    const byPhone = employees.find((e) => {
      const p = digits(e?.phone);
      return p && (attendancePhone.endsWith(p) || p.endsWith(attendancePhone));
    });
    if (byPhone?.name) return String(byPhone.name).trim();
  }

  return attendanceRow.attendanceName;
}

function buildEmployeeScopeIndexes(employees) {
  const byEmail = new Map();
  const byPhone = new Map();
  const byName = new Map();

  employees.forEach((employee) => {
    const email = String(employee?.email || "")
      .trim()
      .toLowerCase();
    if (email) byEmail.set(email, employee);

    const phone = digits(employee?.phone);
    if (phone) byPhone.set(phone, employee);

    const name = normalizeName(employee?.name);
    if (name) byName.set(name, employee);
  });

  return { byEmail, byPhone, byName };
}

function isAttendanceRowInEmployeeScope(attendanceRow, indexes) {
  const email = String(attendanceRow?.email || "")
    .trim()
    .toLowerCase();
  if (email && indexes.byEmail.has(email)) return true;

  const phone = digits(attendanceRow?.phone);
  if (phone) {
    for (const employeePhone of indexes.byPhone.keys()) {
      if (phone.endsWith(employeePhone) || employeePhone.endsWith(phone)) {
        return true;
      }
    }
  }

  const name = normalizeName(attendanceRow?.attendanceName);
  if (name && indexes.byName.has(name)) return true;

  return false;
}

async function run() {
  const cacheDir = path.resolve(".cache");
  const aliasFile = path.join(cacheDir, "person-alias-map.json");
  const publicAliasFile =
    process.env.PERSON_ALIAS_PUBLIC_FILE ||
    path.resolve("ui/public/person-alias-map.json");
  const employeeFile =
    process.env.EMPLOYEE_CACHE_FILE || path.join(cacheDir, "employee.json");

  const token = await getToken();
  const todayPayload = await getTodayDashboard(token);
  const attendanceRows = buildAttendanceRows(todayPayload);

  const employeePayload = await readJsonIfExists(employeeFile, {
    employees: [],
  });
  const employees = Array.isArray(employeePayload)
    ? employeePayload
    : asArray(employeePayload.employees);
  const employeeScope = buildEmployeeScopeIndexes(employees);

  const scopedAttendanceRows = attendanceRows.filter((row) =>
    isAttendanceRowInEmployeeScope(row, employeeScope),
  );
  const existing = await readJsonIfExists(aliasFile, []);
  const scopedKeys = new Set(
    scopedAttendanceRows
      .map((row) => normalizeName(row.attendanceName))
      .filter(Boolean),
  );

  const byKey = new Map();
  asArray(existing).forEach((row) => {
    const key = normalizeName(row.attendanceName || row.pmsName || row.waName);
    if (!key) return;
    if (!scopedKeys.has(key)) return;
    byKey.set(key, row);
  });

  scopedAttendanceRows.forEach((attendanceRow) => {
    const pmsName = resolvePmsName(attendanceRow, employees);
    const key = normalizeName(attendanceRow.attendanceName || pmsName);
    if (!key) return;
    const previous = byKey.get(key);
    byKey.set(key, {
      id: previous?.id || "",
      waName: previous?.waName || "",
      attendanceName: attendanceRow.attendanceName,
      pmsName,
    });
  });

  let counter = 1;
  const result = Array.from(byKey.values())
    .map((row) => ({ ...row }))
    .sort((a, b) =>
      String(a.attendanceName || "").localeCompare(
        String(b.attendanceName || ""),
      ),
    )
    .map((row) => {
      const id = String(row.id || "").trim();
      if (id) return row;
      const next = { ...row, id: String(counter) };
      counter += 1;
      return next;
    });

  await fs.mkdir(cacheDir, { recursive: true });
  await fs.writeFile(aliasFile, JSON.stringify(result, null, 2));
  await fs.mkdir(path.dirname(publicAliasFile), { recursive: true });
  await fs.writeFile(publicAliasFile, JSON.stringify(result, null, 2));

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        aliasFile,
        publicAliasFile,
        attendanceRows: attendanceRows.length,
        scopedAttendanceRows: scopedAttendanceRows.length,
        aliasRows: result.length,
      },
      null,
      2,
    ),
  );
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(
    `Failed to sync person alias map: ${err.message || String(err)}`,
  );
  process.exit(1);
});
