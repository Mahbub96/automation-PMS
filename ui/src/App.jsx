import { useEffect, useMemo, useState } from "react";
import {
  addPenaltyDataRecord,
  getAttendanceByDateFromFirebase,
  getEmployeesFromFirebase,
  getMappingsFromFirebase,
  getPenaltyReasonsFromFirebase,
  getPenaltiesByDateFromFirebase,
  getWhatsAppLogsByDateFromFirebase,
  isFirebaseWebModeAvailable,
  upsertMappingInFirebase,
} from "./firebaseClient";

const toDateString = (date) => date.toISOString().slice(0, 10);
const today = toDateString(new Date());
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || "").replace(
  /\/$/,
  "",
);
const FORCE_FIREBASE_MODE = import.meta.env.VITE_FORCE_FIREBASE_MODE === "true";
const TRACK_EVENTS_URL = `${import.meta.env.BASE_URL}wa-track-events.json`;
const ATTENDANCE_CHECK_URL = `${import.meta.env.BASE_URL}attendance-check.json`;
const TRACK_EVENTS_SSE_URL =
  import.meta.env.VITE_WA_TRACK_SSE_URL || "http://localhost:3099/events";
const EMPLOYEE_CACHE_KEY = "employees-cache-db";
const PENALTY_DISPUTE_CACHE_KEY = "penalty-dispute-cache-db";
const PERSON_ALIAS_CACHE_KEY = "person-alias-cache-db";
const DHAKA_TZ = "Asia/Dhaka";
function toEnvNumber(rawValue, fallback) {
  const cleaned = String(rawValue ?? "")
    .split("#")[0]
    .trim();
  if (!cleaned) return fallback;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const AUTO_APPLY_HOUR = toEnvNumber(import.meta.env.VITE_AUTO_APPLY_HOUR, 17);
const AUTO_APPLY_CHECK_INTERVAL_MS = Number(
  import.meta.env.VITE_AUTO_APPLY_CHECK_INTERVAL_MS || 30000,
);
const TRACK_FALLBACK_REFRESH_MS = Number(
  import.meta.env.VITE_TRACK_FALLBACK_REFRESH_MS || 5000,
);
const DONE_CUTOFF_HOUR = toEnvNumber(
  import.meta.env.VITE_DONE_CUTOFF_HOUR ?? import.meta.env.WA_DONE_CUTOFF_HOUR,
  10,
);
const DONE_CUTOFF_MINUTE = toEnvNumber(
  import.meta.env.VITE_DONE_CUTOFF_MINUTE ??
    import.meta.env.WA_DONE_CUTOFF_MINUTE,
  25,
);
const LATE_DONE_WATCH_MINUTES = toEnvNumber(
  import.meta.env.VITE_LATE_DONE_WATCH_MINUTES,
  10,
);
const DISPUTE_REQUIRED_DONE_COUNT = Number(
  import.meta.env.VITE_DISPUTE_REQUIRED_DONE_COUNT || 1,
);
const DISPUTE_CACHE_RETENTION_HOURS = Number(
  import.meta.env.VITE_DISPUTE_CACHE_RETENTION_HOURS || 12,
);
const DEFAULT_PENALTY_AMOUNT = Number(
  import.meta.env.VITE_DEFAULT_PENALTY_AMOUNT || 100,
);
const DEFAULT_REASON_ID = String(
  import.meta.env.VITE_DEFAULT_REASON_ID || "",
).trim();
const MISSED_DONE_CACHE_KEY = "missed-done-penalty-cache-db";
const LATE_DONE_REASON_TEXT = String(
  import.meta.env.VITE_LATE_DONE_REASON_TEXT || "Late done related one issues",
).trim();

function normalizeDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function normalizeName(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function buildDisputeId(event) {
  return `${event.groupId || "na"}::${event.senderId || "na"}::${event.timestampLocal || event.timestampIso || "na"}`;
}

function isPenalizableEvent(event) {
  return Boolean(event?.isLateDone);
}

function getDisputeRetentionMs() {
  return Math.max(DISPUTE_CACHE_RETENTION_HOURS, 1) * 60 * 60 * 1000;
}

function pruneOldDisputes(rows) {
  const cutoff = Date.now() - getDisputeRetentionMs();
  return rows.filter((row) => {
    const ts = Date.parse(
      row?.event?.timestampLocal || row?.event?.timestampIso || "",
    );
    return Number.isFinite(ts) && ts >= cutoff;
  });
}

function getDhakaNowMeta() {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: DHAKA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(new Date());
  const lookup = Object.fromEntries(
    parts.map((item) => [item.type, item.value]),
  );
  return {
    dateKey: `${lookup.year}-${lookup.month}-${lookup.day}`,
    hour: Number(lookup.hour || "0"),
    minute: Number(lookup.minute || "0"),
  };
}

function hasCrossedCutoff(nowMeta) {
  return (
    nowMeta.hour > DONE_CUTOFF_HOUR ||
    (nowMeta.hour === DONE_CUTOFF_HOUR && nowMeta.minute >= DONE_CUTOFF_MINUTE)
  );
}

function toCutoffTimestampMs(dateKey) {
  const hh = String(DONE_CUTOFF_HOUR).padStart(2, "0");
  const mm = String(DONE_CUTOFF_MINUTE).padStart(2, "0");
  return Date.parse(`${dateKey}T${hh}:${mm}:00+06:00`);
}

function isLateDoneWithinWatchWindow(event) {
  if (!isPenalizableEvent(event)) return false;
  const dateKey = String(
    event.timestampLocal || event.timestampIso || "",
  ).slice(0, 10);
  const eventMs = Date.parse(event.timestampLocal || event.timestampIso || "");
  const cutoffMs = toCutoffTimestampMs(dateKey);
  if (!Number.isFinite(eventMs) || !Number.isFinite(cutoffMs)) return false;
  const watchEndMs =
    cutoffMs + Math.max(LATE_DONE_WATCH_MINUTES, 0) * 60 * 1000;
  return eventMs >= cutoffMs && eventMs <= watchEndMs;
}

function api(path, options) {
  const apiToken = import.meta.env.VITE_API_TOKEN || "";
  const mergedHeaders = { ...(options?.headers || {}) };
  if (apiToken) {
    mergedHeaders["x-api-token"] = apiToken;
  }
  return fetch(`${API_BASE_URL}${path}`, {
    ...(options || {}),
    headers: mergedHeaders,
  }).then(async (res) => {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
    return data;
  });
}

function Pill({ value }) {
  return (
    <span className={`pill ${value ? "yes" : "no"}`}>
      {value ? "Yes" : "No"}
    </span>
  );
}

function Section({ title, children }) {
  return (
    <section className="card">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

function formatTimestamps(value) {
  if (Array.isArray(value)) return value.join(", ");
  return String(value || "");
}

export default function App() {
  const [dataSource, setDataSource] = useState("backend");
  const [health, setHealth] = useState({ ok: false, text: "Checking API..." });
  const [date, setDate] = useState(today);
  const [attendance, setAttendance] = useState([]);
  const [penalties, setPenalties] = useState([]);
  const [logs, setLogs] = useState([]);
  const [trackedEvents, setTrackedEvents] = useState([]);
  const [disputeRows, setDisputeRows] = useState([]);
  const [disputeError, setDisputeError] = useState("");
  const [penaltyReasons, setPenaltyReasons] = useState([]);
  const [selectedReasonId, setSelectedReasonId] = useState("");
  const [applyingDisputeIds, setApplyingDisputeIds] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [mappings, setMappings] = useState([]);
  const [penaltiesOnly, setPenaltiesOnly] = useState(false);
  const [form, setForm] = useState({
    whatsappName: "",
    employeeId: "",
    attendanceName: "",
    pmsName: "",
    officialName: "",
  });
  const [formMessage, setFormMessage] = useState("");
  const [formError, setFormError] = useState(false);
  const [aliasRows, setAliasRows] = useState([]);
  const [aliasForm, setAliasForm] = useState({
    id: "",
    waName: "",
    attendanceName: "",
    pmsName: "",
  });

  const disputeById = useMemo(() => {
    const map = new Map();
    disputeRows.forEach((row) => map.set(row.id, row));
    return map;
  }, [disputeRows]);
  const doneCountBySenderDate = useMemo(() => {
    const counts = new Map();
    trackedEvents.forEach((event) => {
      if (!isPenalizableEvent(event)) return;
      const dateKey = String(
        event.timestampLocal || event.timestampIso || "",
      ).slice(0, 10);
      const sender = event.senderId || event.phone || "unknown";
      const key = `${sender}::${dateKey}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    });
    return counts;
  }, [trackedEvents]);
  const mappingEmployeeByName = useMemo(() => {
    const index = new Map();
    mappings.forEach((item) => {
      const employeeId = item.employeeId || item.employee_id;
      if (!employeeId) return;

      [
        item.whatsappName || item.whatsapp_name,
        item.attendanceName || item.attendance_name,
        item.pmsName || item.pms_name,
        item.officialName || item.official_name,
      ]
        .map((name) => normalizeName(name))
        .filter(Boolean)
        .forEach((key) => {
          if (!index.has(key)) {
            index.set(key, employeeId);
          }
        });
    });
    return index;
  }, [mappings]);
  const employeeById = useMemo(() => {
    const map = new Map();
    employees.forEach((item) => {
      const id = String(item.id || item.employeeId || "").trim();
      if (id) map.set(id, item);
    });
    return map;
  }, [employees]);
  const mappingByEmployeeId = useMemo(() => {
    const map = new Map();
    mappings.forEach((item) => {
      const employeeId = String(
        item.employeeId || item.employee_id || "",
      ).trim();
      if (!employeeId || map.has(employeeId)) return;
      map.set(employeeId, item);
    });
    return map;
  }, [mappings]);
  const aliasCanonicalByName = useMemo(() => {
    const index = new Map();
    aliasRows.forEach((row) => {
      const canonical = normalizeName(
        row.waName || row.attendanceName || row.pmsName,
      );
      if (!canonical) return;
      [row.waName, row.attendanceName, row.pmsName]
        .map((value) => normalizeName(value))
        .filter(Boolean)
        .forEach((alias) => {
          if (!index.has(alias)) {
            index.set(alias, canonical);
          }
        });
    });
    return index;
  }, [aliasRows]);
  const doneMetaByEmployeeId = useMemo(() => {
    const map = new Map();
    trackedEvents.forEach((event) => {
      const eventDate = String(
        event.timestampLocal || event.timestampIso || "",
      ).slice(0, 10);
      if (eventDate !== date) return;
      const employeeId = resolveEmployeeIdForEvent(event);
      if (!employeeId) return;
      const previous = map.get(employeeId);
      const ts = event.timestampLocal || event.timestampIso || "";
      if (!previous || ts > previous.timestamp) {
        map.set(employeeId, {
          done: true,
          timestamp: ts,
          whatsappName: event.whatsappName || "",
        });
      }
    });
    return map;
  }, [
    trackedEvents,
    date,
    mappingEmployeeByName,
    aliasCanonicalByName,
    employees,
  ]);
  const dashboard = useMemo(
    () => ({
      attendanceCount: attendance.length,
      doneCount: trackedEvents.filter((event) => {
        const eventDate = String(
          event.timestampLocal || event.timestampIso || "",
        ).slice(0, 10);
        if (eventDate !== date) return false;
        return Boolean(resolveEmployeeIdForEvent(event));
      }).length,
      penaltyCount: penalties.length,
      mappingCount: mappings.length,
    }),
    [attendance, penalties, mappings, trackedEvents, date],
  );

  function canTakeDisputeAction(item) {
    if (!isPenalizableEvent(item)) {
      return false;
    }
    const dateKey = String(
      item.timestampLocal || item.timestampIso || "",
    ).slice(0, 10);
    const sender = item.senderId || item.phone || "unknown";
    const key = `${sender}::${dateKey}`;
    return (doneCountBySenderDate.get(key) || 0) >= DISPUTE_REQUIRED_DONE_COUNT;
  }

  async function loadMappings(source = dataSource) {
    if (source === "firebase") {
      const users = await getMappingsFromFirebase();
      setMappings(users);
      return;
    }
    const { users } = await api("/users");
    setMappings(users || []);
  }

  async function loadDateBoundResources(
    selectedDate = date,
    source = dataSource,
  ) {
    if (source === "firebase") {
      const [attendanceRes, penaltiesRes, logsRes] = await Promise.all([
        getAttendanceByDateFromFirebase(selectedDate),
        getPenaltiesByDateFromFirebase(selectedDate),
        getWhatsAppLogsByDateFromFirebase(selectedDate),
      ]);
      const attendanceRows = attendanceRes || [];
      if (attendanceRows.length > 0) {
        setAttendance(attendanceRows);
      } else {
        try {
          const fallbackResponse = await fetch(
            `${ATTENDANCE_CHECK_URL}?t=${Date.now()}`,
          );
          if (fallbackResponse.ok) {
            const payload = await fallbackResponse.json();
            if (
              payload?.date === selectedDate &&
              Array.isArray(payload?.records) &&
              payload.records.length > 0
            ) {
              setAttendance(payload.records);
            } else {
              setAttendance([]);
            }
          } else {
            setAttendance([]);
          }
        } catch (_error) {
          setAttendance([]);
        }
      }
      setPenalties(penaltiesRes || []);
      setLogs(logsRes || []);
      return;
    }

    const [attendanceRes, penaltiesRes, logsRes] = await Promise.all([
      api(`/attendance/${selectedDate}`),
      api(`/penalties/${selectedDate}`),
      api(`/whatsapp/logs/${selectedDate}`),
    ]);
    setAttendance(attendanceRes.records || []);
    setPenalties(penaltiesRes.penalties || []);
    setLogs(logsRes.logs || []);
  }

  async function loadTrackedEvents() {
    try {
      const response = await fetch(`${TRACK_EVENTS_URL}?t=${Date.now()}`);
      if (!response.ok) {
        setTrackedEvents([]);
        return;
      }

      const payload = await response.json();
      if (!Array.isArray(payload)) {
        setTrackedEvents([]);
        return;
      }

      const events = payload.slice().reverse();
      setTrackedEvents(events);
      syncDisputeCache(events);
    } catch (_error) {
      setTrackedEvents([]);
    }
  }

  function readDisputeCache() {
    try {
      const raw = localStorage.getItem(PENALTY_DISPUTE_CACHE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
      return [];
    }
  }

  function writeDisputeCache(items) {
    try {
      localStorage.setItem(PENALTY_DISPUTE_CACHE_KEY, JSON.stringify(items));
    } catch (_error) {
      // Ignore browser storage errors.
    }
  }

  function readPersonAliasCache() {
    try {
      const raw = localStorage.getItem(PERSON_ALIAS_CACHE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
      return [];
    }
  }

  function writePersonAliasCache(items) {
    try {
      localStorage.setItem(PERSON_ALIAS_CACHE_KEY, JSON.stringify(items));
    } catch (_error) {
      // Ignore browser storage errors.
    }
  }

  async function loadAliasRowsFromFile() {
    try {
      const response = await fetch(
        `${import.meta.env.BASE_URL}person-alias-map.json?t=${Date.now()}`,
      );
      if (!response.ok) return;
      const payload = await response.json();
      if (!Array.isArray(payload)) return;
      const cleaned = payload
        .map((item) => ({
          id: String(item.id || "").trim(),
          waName: String(item.waName || "").trim(),
          attendanceName: String(item.attendanceName || "").trim(),
          pmsName: String(item.pmsName || "").trim(),
        }))
        .filter(
          (item) =>
            item.id || item.waName || item.attendanceName || item.pmsName,
        );
      if (cleaned.length === 0) return;
      setAliasRows(cleaned);
      writePersonAliasCache(cleaned);
    } catch (_error) {
      // File is optional; keep local cache fallback.
    }
  }

  function readMissedDonePenaltyCache() {
    try {
      const raw = localStorage.getItem(MISSED_DONE_CACHE_KEY);
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_error) {
      return {};
    }
  }

  function writeMissedDonePenaltyCache(mapObject) {
    try {
      localStorage.setItem(MISSED_DONE_CACHE_KEY, JSON.stringify(mapObject));
    } catch (_error) {
      // Ignore browser storage errors.
    }
  }

  function syncDisputeCache(events) {
    const existing = pruneOldDisputes(readDisputeCache());
    const byId = new Map(existing.map((row) => [row.id, row]));

    const merged = events
      .filter((event) => isPenalizableEvent(event))
      .map((event) => {
        const id = buildDisputeId(event);
        const prior = byId.get(id);
        if (prior) {
          return { ...prior, event };
        }
        return {
          id,
          event,
          status: "pending",
          penaltyDocId: "",
          actionMode: "",
          actionAt: "",
          createdAt: Date.now(),
        };
      });

    const pruned = pruneOldDisputes(merged);
    writeDisputeCache(pruned);
    setDisputeRows(pruned);
  }

  function resolveEmployeeIdForEvent(event) {
    const keyRaw = normalizeName(event.whatsappName);
    const key = aliasCanonicalByName.get(keyRaw) || keyRaw;
    const byMapping = mappingEmployeeByName.get(key);
    if (byMapping) return byMapping;

    const eventPhone = normalizeDigits(event.phone || event.senderId);
    if (eventPhone) {
      const matchedEmployee = employees.find((item) => {
        const employeePhone = normalizeDigits(item.phone);
        return employeePhone && eventPhone.endsWith(employeePhone);
      });
      if (matchedEmployee?.id) return matchedEmployee.id;
      if (matchedEmployee?.employeeId) return matchedEmployee.employeeId;
    }

    return "";
  }

  function onSubmitAliasRow(event) {
    event.preventDefault();
    const id = String(aliasForm.id || "").trim();
    const waName = String(aliasForm.waName || "").trim();
    const attendanceName = String(aliasForm.attendanceName || "").trim();
    const pmsName = String(aliasForm.pmsName || "").trim();
    if (!id || !waName) return;

    setAliasRows((prev) => {
      const exists = prev.some((row) => String(row.id) === id);
      const next = exists
        ? prev.map((row) =>
            String(row.id) === id
              ? { id, waName, attendanceName, pmsName }
              : row,
          )
        : [...prev, { id, waName, attendanceName, pmsName }];
      writePersonAliasCache(next);
      return next;
    });

    setAliasForm({ id: "", waName: "", attendanceName: "", pmsName: "" });
  }

  function removeAliasRow(id) {
    setAliasRows((prev) => {
      const next = prev.filter((row) => String(row.id) !== String(id));
      writePersonAliasCache(next);
      return next;
    });
  }

  function updateDisputeRow(nextRow) {
    setDisputeRows((prev) => {
      const next = prev.map((row) => (row.id === nextRow.id ? nextRow : row));
      const pruned = pruneOldDisputes(next);
      writeDisputeCache(pruned);
      return pruned;
    });
  }

  async function applyPenaltyRow(row, mode = "manual") {
    if (!row || row.status !== "pending") return;
    if (applyingDisputeIds.includes(row.id)) return;
    if (!isFirebaseWebModeAvailable()) {
      setDisputeError("Firebase mode is required to apply penalties.");
      return;
    }
    const activeReasonId = selectedReasonId || DEFAULT_REASON_ID;
    if (!activeReasonId) {
      setDisputeError("No valid penalty reason selected.");
      return;
    }
    const resolvedEmployeeId = resolveEmployeeIdForEvent(row.event);
    if (!resolvedEmployeeId) {
      setDisputeError(
        `No employee mapping found for WhatsApp name '${row.event.whatsappName || "unknown"}'.`,
      );
      return;
    }

    try {
      setApplyingDisputeIds((prev) => [...prev, row.id]);
      const penaltyDocId = await addPenaltyDataRecord({
        employee_id: resolvedEmployeeId,
        reason_id: activeReasonId,
        date: String(
          row.event.timestampLocal || row.event.timestampIso || today,
        ).slice(0, 10),
        amount: DEFAULT_PENALTY_AMOUNT,
        status: "PENDING",
        description: `Penalty ${mode} apply from done tracker for ${row.event.whatsappName || "unknown"}`,
      });
      const nextRow = {
        ...row,
        status: "applied",
        penaltyDocId,
        actionMode: mode,
        actionAt: new Date().toISOString(),
      };
      updateDisputeRow(nextRow);
      const cache = readMissedDonePenaltyCache();
      const cacheKey = `${resolvedEmployeeId}::${String(row.event.timestampLocal || row.event.timestampIso || today).slice(0, 10)}`;
      cache[cacheKey] = { penaltyDocId, createdAt: Date.now(), mode };
      writeMissedDonePenaltyCache(cache);
      setDisputeError("");
    } catch (error) {
      setDisputeError(error.message || "Failed to apply penalty.");
    } finally {
      setApplyingDisputeIds((prev) => prev.filter((id) => id !== row.id));
    }
  }

  function rejectPenaltyRow(row) {
    if (!row || row.status !== "pending") return;
    const nextRow = {
      ...row,
      status: "rejected",
      actionMode: "manual",
      actionAt: new Date().toISOString(),
    };
    updateDisputeRow(nextRow);
    setDisputeError("");
  }

  function readEmployeesCache() {
    try {
      const raw = localStorage.getItem(EMPLOYEE_CACHE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (_error) {
      return [];
    }
  }

  function writeEmployeesCache(items) {
    try {
      localStorage.setItem(EMPLOYEE_CACHE_KEY, JSON.stringify(items));
    } catch (_error) {
      // Ignore storage quota and browser privacy mode errors.
    }
  }

  async function loadEmployees(source = dataSource) {
    if (source !== "firebase") {
      setEmployees(readEmployeesCache());
      return;
    }

    try {
      const rows = await getEmployeesFromFirebase();
      setEmployees(rows);
      writeEmployeesCache(rows);
    } catch (_error) {
      setEmployees(readEmployeesCache());
    }
  }

  async function loadPenaltyReasons(source = dataSource) {
    if (source !== "firebase") {
      setPenaltyReasons([]);
      setSelectedReasonId("");
      return;
    }

    try {
      const rows = await getPenaltyReasonsFromFirebase();
      setPenaltyReasons(rows);
      if (rows.length === 0) {
        setSelectedReasonId("");
        return;
      }
      const preferred =
        rows.find(
          (row) =>
            String(row.reason_name || "").toLowerCase() ===
            "testing automation",
        ) || rows[0];
      if (!rows.some((row) => row.id === selectedReasonId)) {
        setSelectedReasonId(preferred.id);
      }
    } catch (_error) {
      setPenaltyReasons([]);
      setSelectedReasonId("");
    }
  }

  async function autoApplyMissedDonePenalties(nowMeta) {
    if (!isFirebaseWebModeAvailable()) return;
    const activeReasonId = selectedReasonId || DEFAULT_REASON_ID;
    if (!activeReasonId) return;
    if (!hasCrossedCutoff(nowMeta)) return;

    const doneEmployeeIds = new Set();
    trackedEvents.forEach((event) => {
      const eventDate = String(
        event.timestampLocal || event.timestampIso || "",
      ).slice(0, 10);
      if (eventDate !== nowMeta.dateKey) return;
      const key = normalizeName(event.whatsappName);
      const employeeId = mappingEmployeeByName.get(key);
      if (employeeId) {
        doneEmployeeIds.add(employeeId);
      }
    });

    const cache = readMissedDonePenaltyCache();

    for (const row of attendance) {
      if (!row || !row.employeeId || !row.present) continue;
      if (doneEmployeeIds.has(row.employeeId)) continue;

      const cacheKey = `${row.employeeId}::${nowMeta.dateKey}`;
      if (cache[cacheKey]) continue;

      try {
        const penaltyDocId = await addPenaltyDataRecord({
          employee_id: row.employeeId,
          reason_id: activeReasonId,
          date: nowMeta.dateKey,
          amount: DEFAULT_PENALTY_AMOUNT,
          status: "PENDING",
          description: LATE_DONE_REASON_TEXT,
        });
        cache[cacheKey] = {
          penaltyDocId,
          createdAt: Date.now(),
        };
        writeMissedDonePenaltyCache(cache);
      } catch (error) {
        setDisputeError(
          error.message || "Failed to auto-apply missed done penalties.",
        );
      }
    }
  }

  async function autoApplyLateDonePenalties(nowMeta) {
    if (!isFirebaseWebModeAvailable()) return;
    const activeReasonId = selectedReasonId || DEFAULT_REASON_ID;
    if (!activeReasonId) return;
    if (!hasCrossedCutoff(nowMeta)) return;

    const cache = readMissedDonePenaltyCache();
    const presentSet = new Set(
      attendance
        .filter((row) => row && row.present && row.employeeId)
        .map((row) => row.employeeId),
    );

    for (const event of trackedEvents) {
      const eventDate = String(
        event.timestampLocal || event.timestampIso || "",
      ).slice(0, 10);
      if (eventDate !== nowMeta.dateKey) continue;
      if (!isLateDoneWithinWatchWindow(event)) continue;

      const employeeId = resolveEmployeeIdForEvent(event);
      if (!employeeId) continue;
      if (!presentSet.has(employeeId)) continue;

      const cacheKey = `${employeeId}::${eventDate}`;
      if (cache[cacheKey]) continue;

      try {
        const penaltyDocId = await addPenaltyDataRecord({
          employee_id: employeeId,
          reason_id: activeReasonId,
          date: eventDate,
          amount: DEFAULT_PENALTY_AMOUNT,
          status: "PENDING",
          description: LATE_DONE_REASON_TEXT,
        });
        cache[cacheKey] = {
          penaltyDocId,
          createdAt: Date.now(),
          mode: "late-done",
        };
        writeMissedDonePenaltyCache(cache);
      } catch (error) {
        setDisputeError(
          error.message || "Failed to auto-apply late done penalties.",
        );
      }
    }
  }

  async function refreshAll(selectedDate = date, source = dataSource) {
    try {
      if (source === "firebase") {
        setHealth({ ok: true, text: "Firebase web mode active" });
      } else {
        await api("/health");
        setHealth({ ok: true, text: "API healthy" });
      }
      await Promise.all([
        loadDateBoundResources(selectedDate, source),
        loadMappings(source),
        loadTrackedEvents(),
        loadEmployees(source),
        loadPenaltyReasons(source),
      ]);
    } catch (error) {
      setHealth({ ok: false, text: `API error: ${error.message}` });
    }
  }

  async function onSubmitMapping(event) {
    event.preventDefault();
    setFormMessage("");
    setFormError(false);

    try {
      if (dataSource === "firebase") {
        await upsertMappingInFirebase({
          whatsappName: form.whatsappName.trim(),
          employeeId: form.employeeId.trim(),
          attendanceName: form.attendanceName.trim() || undefined,
          pmsName: form.pmsName.trim() || undefined,
          officialName:
            form.pmsName.trim() || form.officialName.trim() || undefined,
        });
      } else {
        await api("/mapping", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            whatsappName: form.whatsappName.trim(),
            employeeId: form.employeeId.trim(),
            attendanceName: form.attendanceName.trim() || undefined,
            pmsName: form.pmsName.trim() || undefined,
            officialName:
              form.pmsName.trim() || form.officialName.trim() || undefined,
          }),
        });
      }
      setForm({
        whatsappName: "",
        employeeId: "",
        attendanceName: "",
        pmsName: "",
        officialName: "",
      });
      setFormMessage("Mapping saved.");
      await loadMappings();
    } catch (error) {
      setFormError(true);
      setFormMessage(error.message);
    }
  }

  useEffect(() => {
    setAliasRows(readPersonAliasCache());
    loadAliasRowsFromFile();
  }, []);

  useEffect(() => {
    async function boot() {
      if (FORCE_FIREBASE_MODE && isFirebaseWebModeAvailable()) {
        setDataSource("firebase");
        setHealth({ ok: true, text: "Firebase web mode forced by config" });
        await Promise.all([
          loadDateBoundResources(today, "firebase"),
          loadMappings("firebase"),
          loadTrackedEvents(),
          loadEmployees("firebase"),
          loadPenaltyReasons("firebase"),
        ]);
        return;
      }

      try {
        await api("/health");
        setDataSource("backend");
        setHealth({ ok: true, text: "API healthy" });
        await Promise.all([
          loadDateBoundResources(today, "backend"),
          loadMappings("backend"),
          loadTrackedEvents(),
          loadEmployees("backend"),
          loadPenaltyReasons("backend"),
        ]);
      } catch (_error) {
        if (isFirebaseWebModeAvailable()) {
          setDataSource("firebase");
          setHealth({
            ok: true,
            text: "Firebase web mode active (API unavailable)",
          });
          await Promise.all([
            loadDateBoundResources(today, "firebase"),
            loadMappings("firebase"),
            loadTrackedEvents(),
            loadEmployees("firebase"),
            loadPenaltyReasons("firebase"),
          ]);
          return;
        }
        setHealth({
          ok: false,
          text: "API unavailable and Firebase web mode not configured",
        });
      }
    }

    boot();
  }, []);

  useEffect(() => {
    const timer = setInterval(
      () => {
        const dhakaNow = getDhakaNowMeta();
        if (dhakaNow.hour < AUTO_APPLY_HOUR) return;

        disputeRows.forEach((row) => {
          if (row.status !== "pending") return;
          const rowDate = String(
            row.event?.timestampLocal || row.event?.timestampIso || "",
          ).slice(0, 10);
          if (rowDate !== dhakaNow.dateKey) return;
          if (!canTakeDisputeAction(row.event)) return;
          applyPenaltyRow(row, "auto-5pm");
        });
      },
      Math.max(AUTO_APPLY_CHECK_INTERVAL_MS, 1000),
    );

    return () => clearInterval(timer);
  }, [disputeRows, doneCountBySenderDate]);

  useEffect(() => {
    const timer = setInterval(
      () => {
        const nowMeta = getDhakaNowMeta();
        autoApplyMissedDonePenalties(nowMeta);
        autoApplyLateDonePenalties(nowMeta);
      },
      Math.max(AUTO_APPLY_CHECK_INTERVAL_MS, 1000),
    );

    return () => clearInterval(timer);
  }, [
    attendance,
    trackedEvents,
    mappingEmployeeByName,
    aliasCanonicalByName,
    selectedReasonId,
  ]);

  useEffect(() => {
    let eventSource;
    const fallbackIntervalId = setInterval(
      () => {
        loadTrackedEvents();
      },
      Math.max(TRACK_FALLBACK_REFRESH_MS, 1000),
    );

    try {
      eventSource = new EventSource(TRACK_EVENTS_SSE_URL);
      eventSource.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);
          setTrackedEvents((prev) => [payload, ...prev].slice(0, 1000));
        } catch (_err) {
          // Ignore malformed SSE event payloads.
        }
      };
      eventSource.onerror = async () => {
        await loadTrackedEvents();
      };
    } catch (_err) {
      loadTrackedEvents();
    }

    return () => {
      clearInterval(fallbackIntervalId);
      if (eventSource) {
        eventSource.close();
      }
    };
  }, []);

  const attendanceRows = useMemo(() => {
    const baseRows = penaltiesOnly
      ? attendance.filter((item) => item.penalty)
      : attendance;
    return baseRows.map((item) => {
      const employeeId = String(item.employeeId || "").trim();
      const employee = employeeById.get(employeeId);
      const mapping = mappingByEmployeeId.get(employeeId);
      const doneMeta = doneMetaByEmployeeId.get(employeeId);
      return {
        ...item,
        officialName:
          item.officialName ||
          item.official_name ||
          item.name ||
          employee?.name ||
          "",
        whatsappName:
          item.whatsappName ||
          item.whatsapp_name ||
          doneMeta?.whatsappName ||
          mapping?.whatsappName ||
          mapping?.whatsapp_name ||
          "",
        done: Boolean(item.done) || Boolean(doneMeta?.done),
        timestamps: item.timestamps || doneMeta?.timestamp || "",
      };
    });
  }, [
    attendance,
    penaltiesOnly,
    employeeById,
    mappingByEmployeeId,
    doneMetaByEmployeeId,
  ]);

  return (
    <>
      <header className="topbar">
        <h1>Automation Control Center</h1>
        <div className="topbar-right">
          <span className={`badge ${health.ok ? "ok" : "error"}`}>
            {health.text}
          </span>
          <span className="mode-chip">
            Source: {dataSource === "firebase" ? "Firebase Web" : "Backend API"}
          </span>
        </div>
      </header>

      <main className="layout">
        <Section title="Dashboard">
          <div className="toolbar">
            <label htmlFor="date">Date</label>
            <input
              id="date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
            <button onClick={() => refreshAll(date)}>Refresh</button>
          </div>
          <div className="stats-grid">
            <article className="stat">
              <h3>Attendance Records</h3>
              <p>{dashboard.attendanceCount}</p>
            </article>
            <article className="stat">
              <h3>Done Count</h3>
              <p>{dashboard.doneCount}</p>
            </article>
            <article className="stat">
              <h3>Penalties</h3>
              <p>{dashboard.penaltyCount}</p>
            </article>
            <article className="stat">
              <h3>Mapped Users</h3>
              <p>{dashboard.mappingCount}</p>
            </article>
          </div>
        </Section>

        <Section title="Attendance">
          <div className="toolbar">
            <label>
              <input
                type="checkbox"
                checked={penaltiesOnly}
                onChange={(e) => setPenaltiesOnly(e.target.checked)}
              />
              Penalties only
            </label>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Employee ID</th>
                  <th>Official Name</th>
                  <th>WhatsApp Name</th>
                  <th>Present</th>
                  <th>Done</th>
                  <th>Penalty</th>
                  <th>Timestamps</th>
                </tr>
              </thead>
              <tbody>
                {attendanceRows.length === 0 ? (
                  <tr>
                    <td colSpan={7}>
                      No attendance records for selected date.
                    </td>
                  </tr>
                ) : (
                  attendanceRows.map((item) => (
                    <tr key={item.employeeId}>
                      <td>{item.employeeId}</td>
                      <td>{item.officialName || ""}</td>
                      <td>{item.whatsappName || ""}</td>
                      <td>
                        <Pill value={Boolean(item.present)} />
                      </td>
                      <td>
                        <Pill value={Boolean(item.done)} />
                      </td>
                      <td>
                        <Pill value={Boolean(item.penalty)} />
                      </td>
                      <td>{formatTimestamps(item.timestamps)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Penalties">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Employee ID</th>
                  <th>Reason</th>
                  <th>Created At</th>
                </tr>
              </thead>
              <tbody>
                {penalties.length === 0 ? (
                  <tr>
                    <td colSpan={3}>No penalties for selected date.</td>
                  </tr>
                ) : (
                  penalties.map((item) => (
                    <tr key={item.employeeId}>
                      <td>{item.employeeId}</td>
                      <td>{item.reason || ""}</td>
                      <td>{item.createdAt || ""}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="WhatsApp Logs">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Sender ID</th>
                  <th>WhatsApp Name</th>
                  <th>Message</th>
                  <th>Timestamp</th>
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan={4}>No done logs for selected date.</td>
                  </tr>
                ) : (
                  logs.map((item) => (
                    <tr key={item.id}>
                      <td>{item.senderId}</td>
                      <td>{item.whatsappName || ""}</td>
                      <td>{item.message || ""}</td>
                      <td>{item.timestampIso || ""}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Tracked Done Events (Local Cache)">
          <div className="toolbar">
            <label>
              Penalty Reason
              <select
                value={selectedReasonId}
                onChange={(e) => setSelectedReasonId(e.target.value)}
              >
                <option value="">Select reason</option>
                {penaltyReasons.map((reason) => (
                  <option key={reason.id} value={reason.id}>
                    {reason.reason_name || reason.id}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Group ID</th>
                  <th>Sender ID</th>
                  <th>Phone</th>
                  <th>WhatsApp Name</th>
                  <th>Message</th>
                  <th>Timestamp</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {trackedEvents.length === 0 ? (
                  <tr>
                    <td colSpan={7}>No tracked done events found.</td>
                  </tr>
                ) : (
                  trackedEvents.map((item, idx) => (
                    <tr key={`${item.timestampLocal || "na"}-${idx}`}>
                      <td>{item.groupId || ""}</td>
                      <td>{item.senderId || ""}</td>
                      <td>{item.phone || ""}</td>
                      <td>{item.whatsappName || ""}</td>
                      <td>{item.message || ""}</td>
                      <td>{item.timestampLocal || item.timestampIso || ""}</td>
                      <td>
                        {(() => {
                          const id = buildDisputeId(item);
                          const row = disputeById.get(id);
                          const actionReady = canTakeDisputeAction(item);
                          if (!isPenalizableEvent(item)) {
                            return <span>On time</span>;
                          }
                          if (!row) {
                            return <span>Pending</span>;
                          }
                          if (row.status === "applied") {
                            return <span>Applied</span>;
                          }
                          if (row.status === "rejected") {
                            return <span>Rejected</span>;
                          }
                          if (!actionReady) {
                            return (
                              <span>
                                Waiting (
                                {doneCountBySenderDate.get(
                                  `${item.senderId || item.phone || "unknown"}::${String(item.timestampLocal || item.timestampIso || "").slice(0, 10)}`,
                                ) || 0}
                                /{DISPUTE_REQUIRED_DONE_COUNT})
                              </span>
                            );
                          }
                          return (
                            <div className="toolbar">
                              <button
                                type="button"
                                disabled={applyingDisputeIds.includes(row.id)}
                                onClick={() => applyPenaltyRow(row, "manual")}
                              >
                                {applyingDisputeIds.includes(row.id)
                                  ? "Applying..."
                                  : "Apply"}
                              </button>
                              <button
                                type="button"
                                disabled={applyingDisputeIds.includes(row.id)}
                                onClick={() => rejectPenaltyRow(row)}
                              >
                                Reject
                              </button>
                            </div>
                          );
                        })()}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          {disputeError ? (
            <p className="form-message error">{disputeError}</p>
          ) : null}
        </Section>

        <Section title="Mapping Management">
          <form className="form-grid" onSubmit={onSubmitMapping}>
            <label>
              WhatsApp Name
              <input
                value={form.whatsappName}
                onChange={(e) =>
                  setForm((p) => ({ ...p, whatsappName: e.target.value }))
                }
                required
              />
            </label>
            <label>
              Employee ID
              <input
                value={form.employeeId}
                onChange={(e) =>
                  setForm((p) => ({ ...p, employeeId: e.target.value }))
                }
                required
              />
            </label>
            <label>
              Attendance API Name (optional)
              <input
                value={form.attendanceName}
                onChange={(e) =>
                  setForm((p) => ({ ...p, attendanceName: e.target.value }))
                }
              />
            </label>
            <label>
              PMS Name (optional)
              <input
                value={form.pmsName}
                onChange={(e) =>
                  setForm((p) => ({ ...p, pmsName: e.target.value }))
                }
              />
            </label>
            <label>
              Official Name (legacy optional)
              <input
                value={form.officialName}
                onChange={(e) =>
                  setForm((p) => ({ ...p, officialName: e.target.value }))
                }
              />
            </label>
            <button type="submit">Add / Update Mapping</button>
          </form>
          {formMessage ? (
            <p className={`form-message ${formError ? "error" : "ok"}`}>
              {formMessage}
            </p>
          ) : null}
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Key</th>
                  <th>WhatsApp Name</th>
                  <th>Employee ID</th>
                  <th>Attendance Name</th>
                  <th>PMS Name</th>
                  <th>Updated At</th>
                </tr>
              </thead>
              <tbody>
                {mappings.length === 0 ? (
                  <tr>
                    <td colSpan={6}>No mappings found.</td>
                  </tr>
                ) : (
                  mappings
                    .slice()
                    .sort((a, b) =>
                      (a.whatsappName || "").localeCompare(
                        b.whatsappName || "",
                      ),
                    )
                    .map((item) => (
                      <tr key={item.id}>
                        <td>{item.id}</td>
                        <td>{item.whatsappName}</td>
                        <td>{item.employeeId}</td>
                        <td>{item.attendanceName || ""}</td>
                        <td>{item.pmsName || item.officialName || ""}</td>
                        <td>{item.updatedAt || ""}</td>
                      </tr>
                    ))
                )}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Person Alias Cache (Manual Compare)">
          <form className="form-grid" onSubmit={onSubmitAliasRow}>
            <label>
              Id
              <input
                value={aliasForm.id}
                onChange={(e) =>
                  setAliasForm((p) => ({ ...p, id: e.target.value }))
                }
                required
              />
            </label>
            <label>
              WA
              <input
                value={aliasForm.waName}
                onChange={(e) =>
                  setAliasForm((p) => ({ ...p, waName: e.target.value }))
                }
                required
              />
            </label>
            <label>
              Attendance Name
              <input
                value={aliasForm.attendanceName}
                onChange={(e) =>
                  setAliasForm((p) => ({
                    ...p,
                    attendanceName: e.target.value,
                  }))
                }
              />
            </label>
            <label>
              PMS Name
              <input
                value={aliasForm.pmsName}
                onChange={(e) =>
                  setAliasForm((p) => ({ ...p, pmsName: e.target.value }))
                }
              />
            </label>
            <button type="submit">Add / Update Alias</button>
          </form>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Id</th>
                  <th>WA</th>
                  <th>Attendance Name</th>
                  <th>PMS Name</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {aliasRows.length === 0 ? (
                  <tr>
                    <td colSpan={5}>No alias rows in local cache.</td>
                  </tr>
                ) : (
                  aliasRows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.id}</td>
                      <td>{row.waName}</td>
                      <td>{row.attendanceName || ""}</td>
                      <td>{row.pmsName || ""}</td>
                      <td>
                        <button
                          type="button"
                          onClick={() => removeAliasRow(row.id)}
                        >
                          Delete
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Section>

        <Section title="Employees Cache DB">
          <div className="toolbar">
            <span>Cached employees: {employees.length}</span>
            <button onClick={() => loadEmployees(dataSource)}>
              Refresh Employees
            </button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Designation ID</th>
                </tr>
              </thead>
              <tbody>
                {employees.length === 0 ? (
                  <tr>
                    <td colSpan={5}>No employees in cache yet.</td>
                  </tr>
                ) : (
                  employees.map((item) => (
                    <tr key={item.id}>
                      <td>{item.id}</td>
                      <td>{item.name || ""}</td>
                      <td>{item.email || ""}</td>
                      <td>{item.phone || ""}</td>
                      <td>{item.designation_id || ""}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </Section>
      </main>
    </>
  );
}
