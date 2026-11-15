import type { Config } from '../config.js';
import { withTx, type Pool } from '../db.js';
import { deviceLog } from './device.js';
import { eventFingerprint, parseAttlog, parseUserLines, type ParseError } from '../protocol/iclock.js';

export interface IngestResult { received: number; inserted: number; duplicates: number; errors: ParseError[] }

/**
 * Pipeline: parse -> normalise -> (tx) resolve employee -> dedup insert -> update stamp.
 * Raw request is already persisted by the caller, so a parse failure never discards data.
 * A DB error rolls the whole batch back and is rethrown so the device receives a non-OK reply and retries.
 */
export async function ingestAttlog(
  pool: Pool, cfg: Config,
  dev: { id: string; serial: string }, rawRequestId: string, body: string, stamp: string | null,
): Promise<IngestResult> {
  const { records, errors } = parseAttlog(body);
  let inserted = 0;
  await withTx(pool, async (c) => {
    for (const rec of records) {
      const emp = await c.query(
        `INSERT INTO employees (device_pin) VALUES ($1)
         ON CONFLICT (device_pin) DO UPDATE SET device_pin = EXCLUDED.device_pin RETURNING id`, [rec.pin]);
      const r = await c.query(
        `INSERT INTO attendance_events
           (device_id, employee_id, employee_pin, attendance_timestamp, attendance_time_raw,
            verification_method, punch_status, work_code, event_fingerprint, raw_request_id)
         VALUES ($1,$2,$3, ($4::text)::timestamp AT TIME ZONE $5::text, $4::text, $6,$7,$8,$9,$10)
         ON CONFLICT (device_id, event_fingerprint) DO NOTHING RETURNING id`,
        [dev.id, emp.rows[0].id, rec.pin, rec.time, cfg.deviceTimezone, rec.verify, rec.status, rec.workCode,
         eventFingerprint(dev.serial, rec), rawRequestId]);
      inserted += r.rowCount ?? 0;
    }
    if (stamp) await c.query('UPDATE devices SET last_attlog_stamp=$2, updated_at=now() WHERE id=$1', [dev.id, stamp]);
  });
  if (errors.length) {
    await deviceLog(pool, dev.id, 'parse_error', `${errors.length} attendance line(s) could not be parsed`, { rawRequestId, errors: errors.slice(0, 20) });
  }
  return { received: records.length, inserted, duplicates: records.length - inserted, errors };
}

export async function ingestUsers(pool: Pool, body: string): Promise<number> {
  const users = parseUserLines(body);
  for (const u of users) {
    await pool.query(
      `INSERT INTO employees (device_pin, employee_name) VALUES ($1,$2)
       ON CONFLICT (device_pin) DO UPDATE SET employee_name = COALESCE(EXCLUDED.employee_name, employees.employee_name), updated_at=now()`,
      [u.pin, u.name]);
  }
  return users.length;
}
