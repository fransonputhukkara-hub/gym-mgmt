# Hardware verification checklist

The project is **not** proven until every box below is ticked using the **physical K90**. Simulator data (serial
prefix `SIM-`, orange SIMULATED badge) never counts. For each item, record the evidence (screenshot, dashboard
row id, or captured request) and the date.

| # | Requirement | How to prove | Done | Evidence |
|---|---|---|---|---|
| 1 | Device connectivity | Real request from the device's public IP appears in Monitor | ☐ | |
| 2 | Registration | Real serial listed in Devices, no SIMULATED badge; registration request matches `PROTOCOL.md` | ☐ | |
| 3 | Heartbeat | `last_seen_at` advances roughly every `Delay` seconds; status Online | ☐ | |
| 4 | Attendance event received | Real fingerprint punch creates a row within seconds | ☐ | |
| 5 | PIN extraction | Row PIN equals the PIN enrolled on the device for that finger | ☐ | |
| 6 | Timestamp | Row `attendance_time_raw` equals the time shown on the device at punch; `DEVICE_TIMEZONE` correct | ☐ | |
| 7 | Storage | Row visible in PostgreSQL (`SELECT * FROM attendance_events ORDER BY created_at DESC LIMIT 5`) and raw request retained | ☐ | |
| 8 | Duplicate prevention | Restart receiver, trigger re-send (see 9) or re-register; event count does not grow for the same punch | ☐ | |
| 9 | Historical sync | Block the server (stop nginx for 5 min), make 3 punches, start nginx: all 3 arrive once. Record whether the K90 retries by itself and how long it takes | ☐ | |
| 10 | Network interruption | Unplug device network or drop WAN, reconnect: heartbeats resume without manual action | ☐ | |
| 11 | Verification / status codes | Punch by fingerprint, card/password if available, and check-in/out keys: record the code values the K90 sends and update the mapping in `frontend/src/api.ts` | ☐ | |
| 12 | Server-error behaviour | Stop PostgreSQL briefly, punch, start it: confirm the device resends (receiver returns 500 while DB is down) | ☐ | |
| 13 | Reboot | `sudo reboot` the VM: containers return, device reconnects, no data lost | ☐ | |

Anything that differs from `PROTOCOL.md` must be fixed in code, covered by a test using the captured payload, and
the table in `PROTOCOL.md` changed from ASSUMED to VERIFIED.
