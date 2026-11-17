import type { FastifyInstance } from 'fastify';
import type { Config } from '../config.js';
import type { Pool } from '../db.js';
import { deviceLog, touchDevice } from '../services/device.js';
import { ingestAttlog, ingestUsers } from '../services/ingest.js';
import { firmwareFromInfo, redactBody, redactHeaders, registrationConfig } from '../protocol/iclock.js';

const SN_RE = /^[A-Za-z0-9_.-]{3,40}$/;
type Kind = 'registration' | 'heartbeat' | 'attlog' | 'operlog' | 'command' | 'other';

export function registerDeviceRoutes(app: FastifyInstance, pool: Pool, cfg: Config): void {
  async function saveRaw(p: {
    deviceId: string | null; serial: string | null; kind: Kind; url: string; method: string; ip: string;
    headers: Record<string, unknown>; body: string; status: string; error?: string;
  }): Promise<string> {
    const r = await pool.query(
      `INSERT INTO raw_device_requests
        (device_id, serial_number, request_kind, endpoint, http_method, source_ip, headers_json, raw_body, processing_status, processing_error)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [p.deviceId, p.serial, p.kind, p.url.slice(0, 2000), p.method, p.ip, JSON.stringify(redactHeaders(p.headers)),
       redactBody(p.body), p.status, p.error ?? null]);
    return r.rows[0].id;
  }
  const setRaw = (id: string, status: string, error: string | null) =>
    pool.query('UPDATE raw_device_requests SET processing_status=$2, processing_error=$3 WHERE id=$1', [id, status, error]);

  app.route({
    method: ['GET', 'POST'],
    url: '/iclock/*',
    handler: async (req, reply) => {
      const q: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.query as Record<string, unknown>)) q[k.toUpperCase()] = Array.isArray(v) ? String(v[0]) : String(v);
      // Real K90 firmware uses `.aspx` suffixes (cdata.aspx, getrequest.aspx); other firmware omits them.
      const sub = String((req.params as Record<string, string>)['*'] ?? '').toLowerCase().replace(/\.aspx$/, '');
      const body = typeof req.body === 'string' ? req.body : '';
      const table = (q.TABLE ?? '').toUpperCase();
      const method = req.method;
      const ip = req.ip;
      const sn = q.SN ?? null;

      const kind: Kind =
        sub === 'cdata' && method === 'GET' ? 'registration'
        : sub === 'getrequest' ? 'heartbeat'
        : sub === 'cdata' && table === 'ATTLOG' ? 'attlog'
        : sub === 'cdata' && (table === 'OPERLOG' || table === 'USERINFO') ? 'operlog'
        : sub === 'devicecmd' ? 'command' : 'other';
      const base = { kind, url: req.url, method, ip, headers: req.headers as Record<string, unknown>, body };

      if (!sn || !SN_RE.test(sn)) {
        await saveRaw({ ...base, deviceId: null, serial: sn?.slice(0, 40) ?? null, status: 'rejected', error: 'missing or invalid SN' });
        return reply.code(400).type('text/plain').send('ERROR: SN');
      }

      let dev;
      try {
        dev = await touchDevice(pool, cfg, sn, { ip, firmware: firmwareFromInfo(q.INFO), model: q.DEVICETYPE ?? q.DEVICENAME ?? null });
      } catch (err) {
        req.log.error({ err, sn }, 'device lookup failed');
        return reply.code(500).type('text/plain').send('ERROR: server');
      }
      if (!dev) {
        await saveRaw({ ...base, deviceId: null, serial: sn, status: 'rejected', error: 'serial not permitted' });
        req.log.warn({ sn, ip }, 'rejected unknown device');
        return reply.code(403).type('text/plain').send('ERROR: not permitted');
      }

      let rawId: string;
      try {
        rawId = await saveRaw({ ...base, deviceId: dev.id, serial: sn, status: 'received' });
      } catch (err) {
        req.log.error({ err, sn }, 'raw persist failed');
        return reply.code(500).type('text/plain').send('ERROR: server');
      }

      try {
        if (kind === 'registration') {
          await deviceLog(pool, dev.id, 'registration_request', 'Device requested options', { query: q });
          await setRaw(rawId, 'processed', null);
          return reply.type('text/plain').send(registrationConfig(sn, {
            attlogStamp: dev.lastAttlogStamp, delay: cfg.pollDelaySeconds, errorDelay: cfg.errorDelaySeconds }));
        }
        if (kind === 'heartbeat') {
          await setRaw(rawId, 'processed', null);
          return reply.type('text/plain').send('OK'); // no commands queued: never send unsupported commands
        }
        if (kind === 'attlog') {
          const res = await ingestAttlog(pool, cfg, { id: dev.id, serial: sn }, rawId, body, q.STAMP ?? null);
          const st = res.errors.length === 0 ? 'processed' : res.received === 0 ? 'failed' : 'partial';
          await setRaw(rawId, st, res.errors.length ? JSON.stringify(res.errors.slice(0, 20)) : null);
          req.log.info({ sn, ...res, errors: res.errors.length }, 'attlog ingested');
          return reply.type('text/plain').send('OK');
        }
        if (kind === 'operlog') {
          const n = await ingestUsers(pool, body);
          await setRaw(rawId, 'processed', null);
          req.log.info({ sn, users: n }, 'operlog processed');
          return reply.type('text/plain').send('OK');
        }
        await setRaw(rawId, 'unhandled', null);
        return reply.type('text/plain').send('OK');
      } catch (err) {
        req.log.error({ err, sn, rawId }, 'processing failed');
        await setRaw(rawId, 'failed', (err as Error).message).catch(() => undefined);
        await deviceLog(pool, dev.id, 'ingest_error', (err as Error).message, { rawId });
        // Non-OK so the device keeps the records and retries. Raw payload stays stored.
        return reply.code(500).type('text/plain').send('ERROR: server');
      }
    },
  });

  // Capture mode: anything else carrying an SN is stored so real firmware endpoints can be discovered.
  app.setNotFoundHandler(async (req, reply) => {
    const qs = req.url.includes('?') ? new URLSearchParams(req.url.split('?')[1]) : new URLSearchParams();
    const sn = [...qs.entries()].find(([k]) => k.toUpperCase() === 'SN')?.[1] ?? null;
    if (sn && SN_RE.test(sn)) {
      const body = typeof req.body === 'string' ? req.body : '';
      await pool.query(
        `INSERT INTO raw_device_requests (serial_number, request_kind, endpoint, http_method, source_ip, headers_json, raw_body, processing_status, processing_error)
         VALUES ($1,'other',$2,$3,$4,$5,$6,'unhandled','no handler for this path')`,
        [sn, req.url.slice(0, 2000), req.method, req.ip, JSON.stringify(redactHeaders(req.headers as Record<string, unknown>)), redactBody(body)],
      ).catch(() => undefined);
    }
    return reply.code(404).type('text/plain').send('Not Found');
  });
}
