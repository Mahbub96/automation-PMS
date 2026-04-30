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
   - For Firebase Admin, recommended option is setting `FIREBASE_SERVICE_ACCOUNT_PATH` to your downloaded service-account JSON file.
   - Alternative is using `FIREBASE_CLIENT_EMAIL` + `FIREBASE_PRIVATE_KEY` (or `FIREBASE_PRIVATE_KEY_BASE64`).
4. Build React GUI:
   - `npm run ui:build`
5. Start server:
   - `npm start`
6. On first run, scan WhatsApp QR in terminal.
7. Optional (authenticate WhatsApp before Firebase setup):
   - `npm run wa:login`

## API Endpoints

- `GET /attendance/today`
- `GET /attendance/:date`
- `GET /users`
- `GET /penalties/:date`
- `POST /mapping`
  - body: `{ "whatsappName": "md ali", "employeeId": "E102", "officialName": "Md Ali" }`
- `GET /whatsapp/logs/:date`
- When `API_AUTH_REQUIRED=true`, protected routes require one of:
  - `Authorization: Bearer <API_AUTH_TOKEN>`
  - `x-api-token: <API_AUTH_TOKEN>`

## GUI

- Open `http://localhost:<PORT>/ui` after server startup.
- For GUI development, run `npm run ui:dev` (Vite dev server).
- To run backend + frontend together in one command, run `npm run dev:full`.
- If backend API is unavailable, UI auto-falls back to Firebase Web SDK mode when `VITE_FIREBASE_*` env values are set.
- In frontend-only mode, `dev:full` also starts `wa:track` so WhatsApp `done` tracking continues.
- For frontend-only operation, set `VITE_FORCE_FIREBASE_MODE=true` to skip backend `/health` probe noise.
- Optional API target override for UI: `VITE_API_BASE_URL=http://localhost:3000`.
- Live tracked-events stream endpoint for UI: `VITE_WA_TRACK_SSE_URL` (default `http://localhost:3099/events`).
- The GUI uses live backend APIs (no mock data) for:
  - Daily dashboard summary
  - Attendance by date
  - Penalties by date
  - WhatsApp done logs by date
  - Mapping management (`POST /mapping`)

## WhatsApp Login Check

- Run `npm run wa:login` to verify WhatsApp auth/session without starting Firestore-dependent services.
- This command only needs WhatsApp env values and writes session data to `WHATSAPP_AUTH_PATH`.
- Run `npm run wa:track` to listen for `done` messages in `WHATSAPP_GROUP_ID` without backend Firebase dependency.
- `wa:track` only processes messages from configured `WHATSAPP_GROUP_ID` and stores matched events in `WA_TRACK_CACHE_FILE` as a JSON array for later use.
- `wa:track` also exposes an SSE stream at `WA_TRACK_SSE_PORT` (default `3099`) for instant GUI updates.

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

## Production Readiness

- Run with `NODE_ENV=production`.
- `WHATSAPP_SESSION_SECRET` is mandatory in production.
- Set `API_AUTH_REQUIRED=true` to enforce token auth on API routes.
- Keep WhatsApp auth storage (`WHATSAPP_AUTH_PATH`) on persistent disk.
- Use process supervision (PM2/systemd) and TLS at your reverse proxy.
- Check `GET /health` for dependency state:
  - `status`: `ok` or `degraded`
  - `whatsappReady`: WhatsApp client live state
  - `firestoreReady`: Firestore connectivity on startup
- Validate environment before boot:
  - `npm run validate:config`
- Production start command:
  - `npm run start:prod`
- Use `.env.production.example` as the production env template.

## Notes for Free-Tier

- Firestore Spark plan fits low-medium volume.
- whatsapp-web.js runs from your own server/PC.
- Use one small VM/container and process manager (PM2 optional).
