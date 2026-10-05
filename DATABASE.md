# Database and API

Development uses native Node SQLite (WAL, foreign keys, full synchronous writes). Production uses a remote Turso Cloud **libSQL** database through `@libsql/client/web`, with no embedded replica or on-host SQLite file. Database credentials exist only on the backend. See DEPLOYMENT.md for provisioning and optional upload of existing data.

## Migrations and persistence

`001_initial.sql` is unchanged. `002_telemetry.sql` adds telemetry and device alarm state, and rebuilds the alerts table to permit Wokwi/ESP32 sources while preserving existing history. Migration checksums prevent silently modifying applied SQL. Startup applies missing migrations transactionally and seeds the single workspace/device only if absent. Never delete an applied migration or reset the cloud DB on deployment.

Tables: workspaces, pools, devices, notification_settings, contacts, alerts, audit_log, telemetry, schema_migrations. Workspace and internal IDs retain their original names for compatibility; production is also a single workspace, not a multi-tenant service. Registered device serial: SM-001.

Dashboard mutations use a transaction and If-Match revision. A stale revision returns 409. Contacts normalize Saudi/Arabic phone digits. One unacknowledged alert per device is enforced by a unique partial index. Alerts snapshot the pool name at occurrence. Writes are serialized inside the Node process and database write transactions protect consistency.

Telemetry accepts a dedicated Bearer key; it cannot authenticate to the dashboard. Sample IDs deduplicate retries (matching payload returns 200; changed payload under same ID returns 409). The fingerprint covers all accepted measurement fields. A new accepted measurement returns 201 and persists before replying. Samples older than the newest observation are stored but cannot overwrite current state or trigger an alarm. Clock tolerance: no more than 5 minutes future or 24 hours old.

A high reading triggers an alert only when monitoring is enabled and the device is armed with no active alert. High readings latch the alarm; acknowledgement alone does not re-arm it. A low reading re-arms. Disabling monitoring suppresses new alerts but still stores measurements. Telemetry receipt automatically pairs the device. Last-seen is derived from stored telemetry; the UI considers it offline after 90 seconds without a current reading. It never substitutes a fake battery value.

Telemetry older than 7 days is pruned on ingestion; alert history and contacts remain. Monitor Turso storage/read/write quotas for long-running use. Retention is not a backup policy. `db:backup` only covers local SQLite. Export/backup the cloud DB using Turso tools and verify your chosen plan's recovery features.

## API contract

| Route | Authentication / behavior |
|---|---|
| GET /api/health | Public; SELECT 1 checks DB; 200 ok or 503 unavailable |
| POST /api/login | JSON password plus X-Smart-Monitor: 1; returns session cookie |
| POST /api/logout | Session plus X-Smart-Monitor: 1; clears browser cookie |
| GET /api/state | Session required when APP_PASSWORD is set |
| POST /api/pair | Session, X-Smart-Monitor: 1, If-Match; UI demo pairing |
| PATCH /api/pool | Same; `{ "name": "..." }` |
| PATCH /api/monitoring | Same; `{ "enabled": true }` |
| PATCH /api/settings | Same; boolean phone/sound/escalate preferences |
| POST /api/contacts | Same; name and phone |
| DELETE /api/contacts/:id | Same; empty JSON body |
| POST /api/events/simulate | Same; UI demonstration alert |
| POST /api/events/:id/ack | Same; acknowledge existing event |
| POST /api/import | Same; legacy browser data into pristine workspace only |
| POST /api/iot/telemetry | Authorization: Bearer IOT_API_KEY; no session/If-Match required |

Example telemetry body (use current UTC timestamp and a fresh sample ID):

```json
{"deviceId":"SM-001","sampleId":"unique-uuid","source":"wokwi","waterDetected":true,"batteryPercent":82,"rssi":-51,"timestamp":"2026-10-05T12:00:00.000Z"}
```

`source` is wokwi or esp32. waterDetected must be boolean; batteryPercent finite number 0..100; rssi integer -120..0. JSON payload limit is 8 KiB for telemetry; authenticated device traffic is capped at 120 requests/minute per process. The login limit is 10 attempts/minute per process. Restarting the service resets these in-memory limits; device deduplication lives in the database and persists.

Sessions last 7 days, are signed, HttpOnly, SameSite=Strict and Secure in production. Password or SESSION_SECRET rotation invalidates old sessions. Logout clears the browser cookie; this MVP does not maintain per-session server revocation. Host/origin checks and a custom header protect dashboard mutations against cross-site requests. No permissive CORS is needed for ESP32. Render terminates HTTPS and forwards to the Node listener.
