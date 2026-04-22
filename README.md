# Automated Attendance + Compliance Backend

Production-style, modular Node.js backend for:
- WhatsApp group `done` tracking (`whatsapp-web.js`)
- Daily attendance API pull (`node-cron` at 10:25 Asia/Dhaka)
- Name mapping + fuzzy fallback
- Penalty rule evaluation
- Firestore storage and frontend APIs

## Tech Stack
- Node.js + Express
- Firebase Admin SDK (Firestore)
- whatsapp-web.js (group message reader)
- node-cron

## Folder Structure
```text
src/
  api/
  attendance-api/
  bootstrap/
  core/
  firebase/
    repositories/
  mapping/
  rules-engine/
  scheduler/
  whatsapp/
```

## Setup
1. Install dependencies:
   - `npm install`
2. Copy environment:
   - `cp .env.example .env`
3. Fill all `.env` values (Firebase, attendance API, WhatsApp group ID)
4. Start server:
   - `npm start`
5. On first run, scan WhatsApp QR in terminal.

## API Endpoints
- `GET /attendance/today`
- `GET /attendance/:date`
- `GET /users`
- `GET /penalties/:date`
- `POST /mapping`
  - body: `{ "whatsappName": "md ali", "employeeId": "E102", "officialName": "Md Ali" }`
- `GET /whatsapp/logs/:date`

## Business Rule
- If employee is present in attendance API
- and did not send `done` before 10:25 AM
- then `penalty = true`

## Firestore Model
- `attendance_logs/{date}/users/{employeeId}`
  - `present`, `done`, `penalty`, `officialName`, `whatsappName`, `timestamps`
- `mapping/{normalizedWhatsappName}`
  - `whatsappName`, `employeeId`, `officialName`, `updatedAt`
- `whatsapp_logs/{date}/messages/{senderDateKey}`
  - `senderId`, `whatsappName`, `message`, `timestampIso`, `keyword`
- `penalties/{date}/records/{employeeId}`
  - `employeeId`, `reason`, `createdAt`

## Reliability Features
- Idempotent upserts for attendance and penalties
- Exponential backoff retry for attendance API fetch
- In-memory dedup cache + Firestore doc-key dedup for WhatsApp done logs
- Centralized error handling + rate limiting + input validation

## Notes for Free-Tier
- Firestore Spark plan fits low-medium volume.
- whatsapp-web.js runs from your own server/PC.
- Use one small VM/container and process manager (PM2 optional).
