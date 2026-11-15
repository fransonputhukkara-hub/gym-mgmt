import { timingSafeEqual } from 'node:crypto';
import { statfs } from 'node:fs/promises';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Config } from '../config.js';
import type { Pool } from '../db.js';

function tokenOk(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const a = Buffer.from(given), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
function bearer(req: FastifyRequest): string | undefined {
  const h = req.headers.authorization;
  return h && h.startsWith('Bearer ') ? h.slice(7) : undefined;
}
const csvCell = (v: unknown): string => {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // spreadsheet formula injection guard
  return `"${s.replace(/"/g, '""')}"`;
};
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function registerApiRoutes(app: FastifyInstance, pool: Pool, cfg: Config): void {
  app.get('/health', async (_req, reply) => {
    let db = false;
    try { await pool.query('SELECT 1'); db = true; } catch { /* reported below */ }
    let disk: { freePercent: number; freeGb: number } | null = null;
    try {
      const s = await statfs(cfg.diskPath);
      disk = { freePercent: Math.round((s.bavail / s.blocks) * 1000) / 10, freeGb: Math.round((s.bavail * s.bsize) / 1e8) / 10 };
    } catch { /* optional */ }
    const diskLow = disk !== null && disk.freePercent < cfg.diskMinFreePercent;
    const status = !db ? 'down' : diskLow ? 'degraded' : 'ok';
    if (diskLow) app.log.warn({ disk }, 'disk space low');
    return reply.code(db ? 200 : 503).send({ status, database: db ? 'up' : 'down', disk, uptimeSeconds: Math.round(process.uptime()) });
  });

  app.register(async (api) => {
    api.addHook('onRequest', async (req, reply) => {
      if (!tokenOk(bearer(req), cfg.dashboardToken)) {
        return reply.code(401).header('WWW-Authenticate', 'Bearer').send({ error: 'unauthorized' });
      }
    });
    const tz = cfg.deviceTimezone;
    const thr = cfg.onlineThresholdSeconds;

    api.get('/summary', async () => {
      const r = await pool.query(
        `SELECT
          (SELECT count(*) FROM devices)::int AS total_devices,
          (SELECT count(*) FROM devices WHERE last_seen_at > now() - make_interval(secs => $1))::int AS online_devices,
          (SELECT count(*) FROM attendance_events)::int AS total_events,
          (SELECT count(*) FROM attendance_events
             WHERE (attendance_timestamp AT TIME ZONE $2)::date = (now() AT TIME ZONE $2)::date)::int AS today_events`,
        [thr, tz]);
      const latest = await pool.query(
        `SELECT e.id, e.employee_pin, e.attendance_time_raw, e.server_received_at, d.serial_number, d.is_simulated
         FROM attendance_events e JOIN devices d ON d.id=e.device_id
         ORDER BY e.server_received_at DESC, e.attendance_timestamp DESC LIMIT 1`);
      const s = r.rows[0];
      return { ...s, offline_devices: s.total_devices - s.online_devices, latest_punch: latest.rows[0] ?? null, timezone: tz };
    });

    api.get('/devices', async () => {
      const r = await pool.query(
        `SELECT d.id, d.serial_number, d.model, d.firmware_version, d.device_name, d.location, d.ip_address,
                d.last_seen_at, d.registered_at, d.is_simulated,
                (d.last_seen_at > now() - make_interval(secs => $1)) AS online,
                (SELECT max(server_received_at) FROM attendance_events e WHERE e.device_id=d.id) AS last_event_at,
                (SELECT count(*) FROM attendance_events e WHERE e.device_id=d.id)::int AS event_count
         FROM devices d ORDER BY d.last_seen_at DESC NULLS LAST`, [thr]);
      return { devices: r.rows };
    });

    function attFilter(query: Record<string, string | undefined>) {
      const where: string[] = []; const args: unknown[] = [];
      const add = (sql: string, v: unknown) => { args.push(v); where.push(sql.replace('?', `$${args.length}`)); };
      if (query.pin) add('e.employee_pin ILIKE ?', `%${query.pin.replace(/[%_\\]/g, '\\$&')}%`);
      if (query.device) add('e.device_id = ?::uuid', query.device);
      if (query.from && DATE_RE.test(query.from)) { args.push(tz); add(`e.attendance_timestamp >= (?::date)::timestamp AT TIME ZONE $${args.length}`, query.from); }
      if (query.to && DATE_RE.test(query.to)) { args.push(tz); add(`e.attendance_timestamp < ((?::date) + 1)::timestamp AT TIME ZONE $${args.length}`, query.to); }
      return { sql: where.length ? 'WHERE ' + where.join(' AND ') : '', args };
    }
    const SEL = `SELECT e.id, e.employee_pin, e.attendance_time_raw, e.attendance_timestamp, e.server_received_at,
      e.verification_method, e.punch_status, e.work_code, e.raw_request_id, d.id AS device_id, d.serial_number, d.is_simulated,
      emp.employee_name
      FROM attendance_events e JOIN devices d ON d.id=e.device_id LEFT JOIN employees emp ON emp.id=e.employee_id`;

    api.get('/attendance', async (req, reply) => {
      const q = req.query as Record<string, string | undefined>;
      if (q.device && !/^[0-9a-f-]{36}$/i.test(q.device)) return reply.code(400).send({ error: 'bad device id' });
      const page = Math.max(1, parseInt(q.page ?? '1', 10) || 1);
      const size = Math.min(200, Math.max(1, parseInt(q.pageSize ?? '25', 10) || 25));
      const f = attFilter(q);
      const total = await pool.query(`SELECT count(*)::int AS n FROM attendance_events e ${f.sql}`, f.args);
      const rows = await pool.query(
        `${SEL} ${f.sql} ORDER BY e.attendance_timestamp DESC, e.id LIMIT ${size} OFFSET ${(page - 1) * size}`, f.args);
      return { page, pageSize: size, total: total.rows[0].n, events: rows.rows };
    });

    api.get('/attendance.csv', async (req, reply) => {
      const q = req.query as Record<string, string | undefined>;
      if (q.device && !/^[0-9a-f-]{36}$/i.test(q.device)) return reply.code(400).send({ error: 'bad device id' });
      const f = attFilter(q);
      const rows = await pool.query(`${SEL} ${f.sql} ORDER BY e.attendance_timestamp DESC LIMIT 50000`, f.args);
      const head = ['employee_pin', 'device_time', 'verification_code', 'punch_status_code', 'device_serial', 'simulated', 'server_received_at'];
      const lines = [head.join(',')].concat(rows.rows.map((r) => [
        r.employee_pin, r.attendance_time_raw, r.verification_method, r.punch_status, r.serial_number, r.is_simulated,
        new Date(r.server_received_at).toISOString()].map(csvCell).join(',')));
      return reply.type('text/csv').header('Content-Disposition', 'attachment; filename="attendance.csv"').send(lines.join('\r\n') + '\r\n');
    });

    api.get('/attendance/:id', async (req, reply) => {
      const { id } = req.params as { id: string };
      if (!/^[0-9a-f-]{36}$/i.test(id)) return reply.code(400).send({ error: 'bad id' });
      const r = await pool.query(`${SEL} WHERE e.id=$1`, [id]);
      if (!r.rowCount) return reply.code(404).send({ error: 'not found' });
      const raw = await pool.query(
        'SELECT id, endpoint, http_method, received_at, headers_json, raw_body, processing_status, processing_error FROM raw_device_requests WHERE id=$1',
        [r.rows[0].raw_request_id]);
      return { event: r.rows[0], raw_request: raw.rows[0] ?? null };
    });

    api.get('/requests', async (req) => {
      const q = req.query as Record<string, string | undefined>;
      const size = Math.min(200, Math.max(1, parseInt(q.limit ?? '50', 10) || 50));
      const where: string[] = []; const args: unknown[] = [];
      if (q.status) { args.push(q.status); where.push(`r.processing_status = $${args.length}`); }
      if (q.kind) { args.push(q.kind); where.push(`r.request_kind = $${args.length}`); }
      if (q.hideHeartbeats === '1') where.push(`r.request_kind <> 'heartbeat'`);
      const r = await pool.query(
        `SELECT r.id, r.serial_number, r.request_kind, r.endpoint, r.http_method, r.source_ip, r.received_at,
                r.processing_status, r.processing_error, left(r.raw_body, 4000) AS raw_body, d.is_simulated
         FROM raw_device_requests r LEFT JOIN devices d ON d.id=r.device_id
         ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY r.received_at DESC LIMIT ${size}`, args);
      return { requests: r.rows };
    });

    api.get('/device-logs', async (req) => {
      const q = req.query as Record<string, string | undefined>;
      const size = Math.min(200, Math.max(1, parseInt(q.limit ?? '50', 10) || 50));
      const r = await pool.query(
        `SELECT l.id, l.event_type, l.message, l.details_json, l.created_at, d.serial_number
         FROM device_logs l LEFT JOIN devices d ON d.id=l.device_id ORDER BY l.created_at DESC LIMIT ${size}`);
      return { logs: r.rows };
    });
  }, { prefix: '/api' });
}
