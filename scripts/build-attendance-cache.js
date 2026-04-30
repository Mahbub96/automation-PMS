#!/usr/bin/env node
const fs = require("fs/promises");
const path = require("path");
const dotenv = require("dotenv");
const { dayjs, dateKeyDhaka } = require("../src/core/timezone");

dotenv.config();

function parseTsvRows(raw) {
  return String(raw || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split("\t"));
}

function parseEmployeeCache(raw) {
  const text = String(raw || "").trim();
  if (!text) return [];

  if (text.startsWith("[") || text.startsWith("{")) {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => ({
        employeeId: item.employeeId || item.id || "",
        name: item.name || "",
        email: item.email || "",
        phone: item.phone || "",
        designationId: item.designationId || item.designation_id || "",
      }));
    }
    if (Array.isArray(parsed.employees)) {
      return parsed.employees.map((item) => ({
        employeeId: item.employeeId || item.id || "",
        name: item.name || "",
        email: item.email || "",
        phone: item.phone || "",
        designationId: item.designationId || item.designation_id || "",
      }));
    }
  }

  return parseTsvRows(text).map(toEmployeeRecord);
}

function parseAttendTodayCache(raw) {
  const text = String(raw || "").trim();
  if (!text) return [];

  if (text.startsWith("[") || text.startsWith("{")) {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) {
      return parsed
        .map((item) => (typeof item === "string" ? item : item.employeeId || item.id || ""))
        .filter(Boolean);
    }
    if (Array.isArray(parsed.attendedEmployeeIds)) {
      return parsed.attendedEmployeeIds.filter(Boolean);
    }
  }

  return parseTsvRows(text)
    .map((cols) => cols[0])
    .filter(Boolean);
}

function toEmployeeRecord(cols) {
  return {
    employeeId: cols[0] || "",
    name: cols[1] || "",
    email: cols[2] || "",
    phone: cols[3] || "",
    designationId: cols[4] || "",
  };
}

async function readTsvFile(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return parseTsvRows(raw);
}

async function buildAttendanceSnapshot() {
  const cacheDir = path.resolve(".cache");
  const employeeFile = process.env.EMPLOYEE_CACHE_FILE || path.join(cacheDir, "employee.json");
  const attendFile = process.env.ATTEND_TODAY_FILE || path.join(cacheDir, "attend_today.json");
  const outputFile =
    process.env.ATTENDANCE_CHECK_OUTPUT_FILE || path.join(cacheDir, "attendance-check.json");
  const publicOutputFile =
    process.env.ATTENDANCE_CHECK_PUBLIC_FILE ||
    path.resolve("ui/public/attendance-check.json");

  const employeeRaw = await fs.readFile(employeeFile, "utf8");
  const attendRaw = await fs.readFile(attendFile, "utf8");

  const employees = parseEmployeeCache(employeeRaw).filter((x) => x.employeeId);
  const attendedSet = new Set(parseAttendTodayCache(attendRaw));
  const nowLocal = dayjs().tz(process.env.TIMEZONE || "Asia/Dhaka");
  const date = dateKeyDhaka(nowLocal.toISOString());

  const records = employees.map((employee) => ({
    ...employee,
    present: attendedSet.has(employee.employeeId),
    done: false,
    penalty: false,
    reason: "",
  }));

  const presentCount = records.filter((x) => x.present).length;
  const absentCount = records.length - presentCount;

  const payload = {
    generatedAt: nowLocal.format("YYYY-MM-DDTHH:mm:ssZ"),
    date,
    summary: {
      totalEmployees: records.length,
      presentCount,
      absentCount,
      attendanceRate: records.length ? Number(((presentCount / records.length) * 100).toFixed(2)) : 0,
    },
    records,
  };

  await fs.mkdir(path.dirname(outputFile), { recursive: true });
  await fs.writeFile(outputFile, JSON.stringify(payload, null, 2));
  await fs.mkdir(path.dirname(publicOutputFile), { recursive: true });
  await fs.writeFile(publicOutputFile, JSON.stringify(payload, null, 2));

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        outputFile,
        publicOutputFile,
        date,
        totalEmployees: records.length,
        presentCount,
        absentCount,
      },
      null,
      2,
    ),
  );
}

buildAttendanceSnapshot().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("Failed to build attendance cache:", err.message || String(err));
  process.exit(1);
});
