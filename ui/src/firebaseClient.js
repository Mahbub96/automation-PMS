import { initializeApp } from "firebase/app";
import {
  addDoc,
  collection,
  doc,
  getDocs,
  getFirestore,
  setDoc,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY || "",
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "",
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID || "",
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET || "",
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || "",
  appId: import.meta.env.VITE_FIREBASE_APP_ID || "",
};

function hasFirebaseConfig() {
  return Boolean(
    firebaseConfig.apiKey &&
    firebaseConfig.authDomain &&
    firebaseConfig.projectId &&
    firebaseConfig.appId,
  );
}

let db = null;

function getDb() {
  if (!hasFirebaseConfig()) {
    throw new Error(
      "Missing VITE_FIREBASE_* config for frontend Firebase mode.",
    );
  }
  if (db) return db;
  const app = initializeApp(firebaseConfig);
  db = getFirestore(app);
  return db;
}

function normalizeKey(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ");
}

function mapDocs(snapshot) {
  return snapshot.docs.map((item) => ({ id: item.id, ...item.data() }));
}

export function isFirebaseWebModeAvailable() {
  return hasFirebaseConfig();
}

export async function getMappingsFromFirebase() {
  const snapshot = await getDocs(collection(getDb(), "mapping"));
  return mapDocs(snapshot);
}

export async function upsertMappingInFirebase({
  whatsappName,
  employeeId,
  officialName,
  attendanceName,
  pmsName,
}) {
  const key = normalizeKey(whatsappName);
  if (!key) {
    throw new Error("whatsappName is required.");
  }
  const payload = {
    whatsappName: String(whatsappName).trim(),
    employeeId: String(employeeId).trim(),
    officialName: (pmsName || officialName) ? String(pmsName || officialName).trim() : "",
    pmsName: pmsName ? String(pmsName).trim() : "",
    attendanceName: attendanceName ? String(attendanceName).trim() : "",
    updatedAt: new Date().toISOString(),
  };
  await setDoc(doc(getDb(), "mapping", key), payload, { merge: true });
}

export async function getAttendanceByDateFromFirebase(dateKey) {
  const snapshot = await getDocs(
    collection(getDb(), "attendance_logs", dateKey, "users"),
  );
  return mapDocs(snapshot);
}

export async function getPenaltiesByDateFromFirebase(dateKey) {
  const snapshot = await getDocs(
    collection(getDb(), "penalties", dateKey, "records"),
  );
  return mapDocs(snapshot);
}

export async function getWhatsAppLogsByDateFromFirebase(dateKey) {
  const snapshot = await getDocs(
    collection(getDb(), "whatsapp_logs", dateKey, "messages"),
  );
  return mapDocs(snapshot);
}

export async function getEmployeesFromFirebase() {
  const snapshot = await getDocs(collection(getDb(), "employee"));
  return mapDocs(snapshot);
}

export async function getPenaltyReasonsFromFirebase() {
  const snapshot = await getDocs(collection(getDb(), "penalty-reasons"));
  return mapDocs(snapshot);
}

export async function addPenaltyDataRecord(payload) {
  const record = {
    ...payload,
    createdAt: Date.now(),
    modifiedAt: Date.now(),
  };
  const ref = await addDoc(collection(getDb(), "penalty-data"), record);
  return ref.id;
}
