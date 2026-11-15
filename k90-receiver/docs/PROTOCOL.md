# Protocol notes: eSSL K90 ADMS / iclock push

## Verification status

**Nothing in this document has been verified against a physical K90 yet.** The receiver implements the widely
documented ZKTeco/eSSL "iclock" push protocol (eSSL devices are ZKTeco OEM hardware). Firmware varies, so each item
below is marked:

- **ASSUMED** – taken from public protocol descriptions; must be confirmed from a real capture.
- **VERIFIED** – confirmed against a capture from the real K90 (fill in as you go, see `VERIFICATION_CHECKLIST.md`).

Nothing is VERIFIED today. Simulator tests prove the software handles these formats; they do not prove the K90 sends them.

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

On registration the receiver replies `ATTLOGStamp=<last stamp it stored>` or `None` for a device it has never stored a stamp for.
In the iclock protocol this lets the device decide what to (re)send. The receiver stores `Stamp` only after the batch transaction
commits. Because of deduplication, re-sent history is harmless. **Whether the K90 honours `ATTLOGStamp=None` by uploading its
backlog is UNVERIFIED**; test by punching while the server is unreachable (see checklist item 9) and by observing
what the device sends after first registration.

## Security notes on the protocol

The iclock push protocol has no strong authentication; the serial number is the only identifier and is not secret.
Controls: serial allow-list (`ALLOWED_DEVICE_SERIALS`), optional source-IP allow-list in nginx, rate limiting,
body size limit, strict input validation, parameterised SQL only, and no dashboard data exposed on `/iclock/*`.
Set `ALLOWED_DEVICE_SERIALS` to the real serial as soon as the first connection is captured.
