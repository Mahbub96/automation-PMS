import { useEffect, useMemo, useState } from "react";
import {
  getAttendanceByDateFromFirebase,
  getMappingsFromFirebase,
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
const TRACK_EVENTS_SSE_URL =
  import.meta.env.VITE_WA_TRACK_SSE_URL || "http://localhost:3099/events";

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

export default function App() {
  const [dataSource, setDataSource] = useState("backend");
  const [health, setHealth] = useState({ ok: false, text: "Checking API..." });
  const [date, setDate] = useState(today);
  const [attendance, setAttendance] = useState([]);
  const [penalties, setPenalties] = useState([]);
  const [logs, setLogs] = useState([]);
  const [trackedEvents, setTrackedEvents] = useState([]);
  const [mappings, setMappings] = useState([]);
  const [penaltiesOnly, setPenaltiesOnly] = useState(false);
  const [form, setForm] = useState({
    whatsappName: "",
    employeeId: "",
    officialName: "",
  });
  const [formMessage, setFormMessage] = useState("");
  const [formError, setFormError] = useState(false);

  const dashboard = useMemo(
    () => ({
      attendanceCount: attendance.length,
      doneCount: attendance.filter((x) => x.done).length,
      penaltyCount: penalties.length,
      mappingCount: mappings.length,
    }),
    [attendance, penalties, mappings],
  );

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
      setAttendance(attendanceRes || []);
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

      setTrackedEvents(payload.slice().reverse());
    } catch (_error) {
      setTrackedEvents([]);
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
          officialName: form.officialName.trim() || undefined,
        });
      } else {
        await api("/mapping", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            whatsappName: form.whatsappName.trim(),
            employeeId: form.employeeId.trim(),
            officialName: form.officialName.trim() || undefined,
          }),
        });
      }
      setForm({ whatsappName: "", employeeId: "", officialName: "" });
      setFormMessage("Mapping saved.");
      await loadMappings();
    } catch (error) {
      setFormError(true);
      setFormMessage(error.message);
    }
  }

  useEffect(() => {
    async function boot() {
      if (FORCE_FIREBASE_MODE && isFirebaseWebModeAvailable()) {
        setDataSource("firebase");
        setHealth({ ok: true, text: "Firebase web mode forced by config" });
        await Promise.all([
          loadDateBoundResources(today, "firebase"),
          loadMappings("firebase"),
          loadTrackedEvents(),
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
    let eventSource;

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
      if (eventSource) {
        eventSource.close();
      }
    };
  }, []);

  const attendanceRows = penaltiesOnly
    ? attendance.filter((item) => item.penalty)
    : attendance;

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
                      <td>{(item.timestamps || []).join(", ")}</td>
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
                </tr>
              </thead>
              <tbody>
                {trackedEvents.length === 0 ? (
                  <tr>
                    <td colSpan={6}>No tracked done events found.</td>
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
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
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
              Official Name (optional)
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
                  <th>Official Name</th>
                  <th>Updated At</th>
                </tr>
              </thead>
              <tbody>
                {mappings.length === 0 ? (
                  <tr>
                    <td colSpan={5}>No mappings found.</td>
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
                        <td>{item.officialName || ""}</td>
                        <td>{item.updatedAt || ""}</td>
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
