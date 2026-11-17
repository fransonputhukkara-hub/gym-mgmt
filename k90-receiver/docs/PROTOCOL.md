# Protocol notes: eSSL K90 ADMS / iclock push

## Verification status

Partly verified. Firmware serial `NFZ8235001760` (eSSL K90) was captured by the `k90-diagnostic` service on 2026-11-15
to 2026-11-17. That service logged only method, path, serial, body and a classification. **Query strings and the
server's replies were not captured.** Items are marked:

- **VERIFIED** – seen in real captures from the physical K90.
- **ASSUMED** – taken from public iclock protocol descriptions; still needs a real capture.

| Item | Status | Evidence |
|---|---|---|
| Paths end in `.aspx`: `GET /iclock/getrequest.aspx`, `/iclock/cdata.aspx` | VERIFIED | Real captures. Receiver strips `.aspx` (fixed after this was found) |
| Heartbeat is `GET /iclock/getrequest.aspx` every ~10 s with empty body | VERIFIED | Captures on 2026-11-17 at 10 s spacing |
| Attendance is `POST /iclock/cdata.aspx` with tab-separated lines | VERIFIED | Captures. Layout below |
| Real-time push: a punch arrives within about a second | VERIFIED | 2026-11-15 14:55:24 punch received 09:25:24Z (= 14:55:24 IST) |
| Backlog upload after downtime (device buffers and sends later) | VERIFIED | 2026-11-15 01:07 to 02:23 punches arrived at 09:13Z in one batch |
| Device clock sends local time with no offset, and it is IST (UTC+5:30) | VERIFIED | Device time equals receipt time plus 5 h 30 min |
| Operation log body begins `OPLOG <n>\t...` | VERIFIED (body only) | One capture. Fields not interpreted |
| Query parameter `SN` (serial) and `table=ATTLOG` for attendance | VERIFIED (indirectly) | The diagnostic service reads `SN` and `table` and classified real requests as attendance, so both exist. `Stamp` is still unseen |
| Registration: `GET /iclock/cdata.aspx?SN=...` answered with the option block | VERIFIED (reply) | The device runs on the diagnostic service's reply (Delay=10, ErrorDelay=30, TransFlag=`TransData AttLog\tOpLog`, Realtime=1, no ATTPHOTOStamp). The production receiver sends the identical text, covered by a byte-for-byte test. The registration request itself (parameters) was not logged |
| Reply `OK` to heartbeat and attendance POSTs | VERIFIED | `server.js` of the diagnostic service replies `OK` and the device uploads each punch once and keeps its 10 s heartbeat |
| Meaning of `verify` = `2` and `status` = `0` | UNKNOWN | Every captured punch has status 0, verify 2. Needs a known test (finger vs card vs password) |

### Real attendance line layout (VERIFIED)

```
1 \t 2026-11-15 14:55:24 \t 0 \t 2 \t 0 \t \t \t 0 \t 0 \t
PIN   time (device local)    status verify workcode  (reserved/empty ...)
```

10 tab-separated fields with a trailing tab. Fields 1 to 5 are used by the receiver; the rest are kept in the raw
body. Observed so far: only PIN `1`. Punches a few seconds apart by the same PIN are distinct events and must all be
kept (real example: 07:43:05, 07:43:07, 07:43:09). The fingerprint includes the second, so they are.

Nothing here replaces testing the production receiver with the physical device (`VERIFICATION_CHECKLIST.md`).
The tests in `backend/tests/real-device.test.ts` replay the real bodies above.

## How to verify (capture mode)

The receiver stores every request, byte-for-byte (minus redacted secrets), in `raw_device_requests`, including
requests to unknown paths as long as they carry an `SN` parameter (`processing_status = 'unhandled'`). Point the K90 at
the server, then open **Monitor** in the dashboard (or `GET /api/requests`) and compare against the table below.
If the real firmware uses different paths, parameters or body formats, adjust `src/protocol/iclock.ts` and
`src/routes/device.ts`, add the captured payload as a test fixture, and update this table.

## Endpoints implemented

| Purpose | Request (ASSUMED) | Receiver behaviour | Reply (ASSUMED) |
|---|---|---|---|
| Registration | `GET /iclock/cdata?SN=<sn>&options=all&pushver=..&language=..` | Upsert device, mark online, log `registration_request` | Plain-text option block (`GET OPTION FROM: <sn>`, `ATTLOGStamp`, `Delay`, `ErrorDelay`, `TransFlag`, `Realtime`, …) |
| Heartbeat / command poll | `GET /iclock/getrequest?SN=<sn>[&INFO=Ver,UserCount,FPCount,AttCount,IP,…]` | Update `last_seen_at`, status online; firmware read from first `INFO` field if present | `OK` (no commands queued) |
| Attendance upload | `POST /iclock/cdata?SN=<sn>&table=ATTLOG&Stamp=<n>` | Parse, dedup, insert (see below) | `OK` |
| User/operation log | `POST /iclock/cdata?SN=<sn>&table=OPERLOG` (or `USERINFO`) | Only `USER PIN=..\tName=..` lines are used (employee names). Templates, passwords and card numbers are redacted before storage | `OK` |
| Command result | `POST /iclock/devicecmd?SN=<sn>` | Stored raw | `OK` |
| Anything else under `/iclock/*` | any | Stored raw, status `unhandled` | `OK` |

Server errors (database unavailable, transaction failure) return **HTTP 500 `ERROR: server`** so the device retains its
records and retries. Rejected devices get 403; missing/invalid `SN` gets 400. Whether the K90 accepts these status
codes the way the receiver expects is part of the verification checklist.

The receiver never sends commands (no `C:` lines from `getrequest`), because no command has been verified for this
firmware. The device is never instructed to delete or clear anything.

## Attendance record format (ASSUMED)

Tab-separated, one record per line, possibly many lines per POST (batches are supported):

```
PIN \t YYYY-MM-DD HH:MM:SS \t Status \t Verify \t WorkCode \t Reserved…
```

A whitespace-separated variant (`PIN YYYY-MM-DD HH:MM:SS status verify …`) is also accepted. CRLF and LF are both fine.
Lines that cannot be parsed (bad PIN, impossible date, unknown shape) are reported in the raw request's
`processing_error`, logged to `device_logs` (`parse_error`), and the request status becomes `partial` or `failed`.
Good lines in the same request are still stored. The request is still acknowledged `OK` (the raw payload is safe in
the database; replying with an error would make the device resend the same bad line forever).

### Field handling

| Field | Stored as | Notes |
|---|---|---|
| PIN | `employee_pin` (text) | 1–24 chars `[A-Za-z0-9_-]`. External identifier only. An `employees` row is created per PIN; names are filled from OPERLOG user lines when the device sends them |
| Time | `attendance_time_raw` (exact text) and `attendance_timestamp` (timestamptz) | The device sends local time with no offset. It is interpreted in `DEVICE_TIMEZONE` (default `Asia/Kolkata`). Server receipt time is separate (`server_received_at`). **Set `DEVICE_TIMEZONE` to match the K90's clock setting** |
| Status | `punch_status` | Raw code, not mapped (K90 meaning of codes unverified) |
| Verify | `verification_method` | Raw code, not mapped in the database. The dashboard shows a *provisional* label with a trailing "?" for common ZK codes (0 password, 1 fingerprint, 2 card, 15 face) |
| WorkCode | `work_code` | Raw |

## Deduplication

ATTLOG has no verified per-record ID. Strategy (`eventFingerprint` in `src/protocol/iclock.ts`):

```
sha256(serial | pin | time(second resolution) | status | verify | workcode)
UNIQUE (device_id, event_fingerprint)   -- insert uses ON CONFLICT DO NOTHING
```

- Replays after network failure, device re-uploads, and history re-sync collapse to one row.
- Different people with the same timestamp are kept. The same person with a different status or verify method at the
  same second is kept.
- Limitation: two punches identical in *every* field including the second are treated as one. A real human cannot
  produce that on a fingerprint reader, and the device's own log has the same second resolution.
- If capture shows the K90 sends a record/log ID, store it in `device_event_id` (a partial unique index already
  exists) and include it in the fingerprint.

## Historical data

By default the receiver replies `ATTLOGStamp=None`, exactly like the proven diagnostic service. It still records the `Stamp` of each committed upload; set `ECHO_ATTLOG_STAMP=true` to send the stored value on registration (UNVERIFIED on the K90).
In the iclock protocol this lets the device decide what to (re)send. The receiver stores `Stamp` only after the batch transaction
commits. Because of deduplication, re-sent history is harmless. **Whether the K90 honours `ATTLOGStamp=None` by uploading its
backlog is UNVERIFIED**; test by punching while the server is unreachable (see checklist item 9) and by observing
what the device sends after first registration.

## Security notes on the protocol

The iclock push protocol has no strong authentication; the serial number is the only identifier and is not secret.
Controls: serial allow-list (`ALLOWED_DEVICE_SERIALS`), optional source-IP allow-list in nginx, rate limiting,
body size limit, strict input validation, parameterised SQL only, and no dashboard data exposed on `/iclock/*`.
Set `ALLOWED_DEVICE_SERIALS` to the real serial as soon as the first connection is captured.
