# eSSL K90 → Oracle Cloud attendance receiver

Receives attendance punches pushed by an eSSL K90 (ADMS/iclock push) and stores them in PostgreSQL, with a small
dashboard to prove the pipeline works. Scope is device connectivity only: no gym, billing, payroll, etc.

```
K90 --HTTP/80--> nginx --> receiver (Fastify, Node 22, TypeScript) --> PostgreSQL 17
Browser --HTTPS/443--> nginx --> dashboard (React/Vite/Tailwind) + /api
```

## Status (read this)

| Area | State |
|---|---|
| Receiver, parser, dedup, migrations, dashboard API | Implemented; 24 integration tests pass against a real PostgreSQL (16 in the dev sandbox) |
| Dashboard | Built; Summary, Devices, Attendance (search, date, device filters, pagination, CSV, raw view), Monitor |
| Protocol correctness for the **real K90** | **Unverified.** Based on the public iclock push protocol; needs a capture from your device. See `docs/PROTOCOL.md` |
| Device menu configuration | **Not verified.** Guide lists what to set and leaves menu paths for you to confirm, `docs/DEVICE_CONFIGURATION.md` |
| Oracle deployment (Docker Compose, nginx, Let's Encrypt) | Written but **not executed**: the dev sandbox has no Docker daemon, no Oracle account, no public DNS |
| Physical-device proof | **Not done.** Use `docs/VERIFICATION_CHECKLIST.md` |

## Layout

```
backend/    Fastify receiver, SQL migrations, simulator, tests
frontend/   React dashboard
deploy/     docker-compose.yml, nginx, cert bootstrap, backup + monitor scripts, .env.example
docs/       PROTOCOL, DEVICE_CONFIGURATION, NETWORK, VERIFICATION_CHECKLIST
```

## Local development

```bash
cd backend && npm install
export DATABASE_URL=postgres://user:pass@localhost:5432/k90 DASHBOARD_TOKEN=$(openssl rand -hex 16)
npm run dev                                    # receiver on :3000, migrations auto-applied
npm run simulate -- --base-url=http://localhost:3000 --serial=SIM-0001   # protocol simulator (labelled SIMULATED)

cd ../frontend && npm install && npm run dev   # dashboard on :5173, proxies /api to :3000
```

Tests need a PostgreSQL database they may wipe (they `DROP SCHEMA public`):

```bash
TEST_DATABASE_URL=postgres://postgres@localhost:5433/k90test npm test   # in backend/
```

## Deploy on the Oracle VM

1. Follow `docs/NETWORK.md` (security list, VM firewall, block volume at `/mnt/data`, DNS).
2. Install Docker + Compose plugin, clone this repo to `/opt/k90`.
3. ```bash
   cd /opt/k90/k90-receiver/deploy && cp .env.example .env && chmod 600 .env && nano .env
   mkdir -p /mnt/data/k90/pgdata
   ./scripts/init-letsencrypt.sh
   ```
4. Dashboard: `https://<DOMAIN>/`, sign in with `DASHBOARD_TOKEN`.
5. Cron: `scripts/backup.sh` daily, `scripts/monitor.sh` every 5 minutes.
6. Configure the K90 (`docs/DEVICE_CONFIGURATION.md`), then work through `docs/VERIFICATION_CHECKLIST.md`.

Containers use `restart: unless-stopped`; enable Docker at boot (`systemctl enable docker`) so the stack returns after a reboot.

## Configuration (environment)

| Variable | Default | Meaning |
|---|---|---|
| `DATABASE_URL` | required | PostgreSQL connection string |
| `DASHBOARD_TOKEN` | required, ≥16 chars | Bearer token for `/api/*` |
| `DEVICE_TIMEZONE` | `Asia/Kolkata` | Zone of the K90's clock (device sends local time without offset) |
| `ALLOWED_DEVICE_SERIALS` | empty | Comma list; non-empty = only these serials may connect |
| `AUTO_REGISTER_DEVICES` | `true` | When no allow-list, accept unknown serials |
| `ONLINE_THRESHOLD_SECONDS` | `180` | No heartbeat for this long = offline |
| `HEARTBEAT_RETENTION_DAYS` | `14` | Heartbeat raw requests older than this are pruned (attendance raw requests are kept) |
| `DISK_MIN_FREE_PERCENT` | `10` | `/health` reports `degraded` below this |

## Design notes

- **Raw first.** Every device request is saved before parsing. Parse failures never discard data; bad lines are
  flagged in `processing_error` and `device_logs`.
- **Atomic batches.** A batch is one DB transaction. On DB failure the receiver replies HTTP 500 so the device keeps and re-sends the records.
- **Dedup.** `UNIQUE(device_id, sha256(serial|pin|time|status|verify|workcode))`, documented in `PROTOCOL.md`.
- **Time.** Device time is preserved verbatim (`attendance_time_raw`) and converted with `DEVICE_TIMEZONE` into `attendance_timestamp`; receipt time is a separate column.
- **Privacy.** Biometric templates, passwords and card numbers are redacted before storing raw bodies; auth headers are redacted.
- **Simulated data.** Serials starting `SIM-` are flagged `is_simulated` and shown with a SIMULATED badge.
