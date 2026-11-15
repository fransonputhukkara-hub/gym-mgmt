import type { Config } from '../config.js';
import type { Pool } from '../db.js';

export interface DeviceInfo { id: string; serial: string; isNew: boolean; wasOffline: boolean; lastAttlogStamp: string | null }

/** Returns null when the serial is not permitted to register/connect. */
export async function touchDevice(
  pool: Pool,
  cfg: Config,
  serial: string,
  info: { ip: string | null; model?: string | null; firmware?: string | null },
): Promise<DeviceInfo | null> {
  const existing = await pool.query('SELECT id, status, last_attlog_stamp FROM devices WHERE serial_number=$1', [serial]);
  const allowListed = cfg.allowedDeviceSerials.length > 0;
  if (allowListed && !cfg.allowedDeviceSerials.includes(serial)) return null;
  if (!allowListed && !cfg.autoRegisterDevices && existing.rowCount === 0) return null;

  const r = await pool.query(
    `INSERT INTO devices (serial_number, model, firmware_version, ip_address, status, last_seen_at)
     VALUES ($1,$2,$3,$4,'online',now())
     ON CONFLICT (serial_number) DO UPDATE SET
       last_seen_at = now(), status='online', updated_at = now(),
       ip_address = COALESCE($4, devices.ip_address),
       firmware_version = COALESCE($3, devices.firmware_version),
       model = COALESCE($2, devices.model)
     RETURNING id, last_attlog_stamp, (xmax = 0) AS inserted`,
    [serial, info.model ?? null, info.firmware ?? null, info.ip],
  );
  const row = r.rows[0];
  const dev: DeviceInfo = {
    id: row.id, serial, isNew: row.inserted, lastAttlogStamp: row.last_attlog_stamp,
    wasOffline: existing.rowCount === 0 ? false : existing.rows[0].status !== 'online',
  };
  if (dev.isNew) await deviceLog(pool, dev.id, 'registered', 'Device registered', { ip: info.ip });
  else if (dev.wasOffline) await deviceLog(pool, dev.id, 'came_online', 'Device came online', { ip: info.ip });
  return dev;
}

export async function deviceLog(pool: Pool, deviceId: string | null, type: string, message: string, details: unknown = {}) {
  await pool.query('INSERT INTO device_logs (device_id, event_type, message, details_json) VALUES ($1,$2,$3,$4)', [
    deviceId, type, message, JSON.stringify(details),
  ]).catch(() => undefined); // logging must never break ingestion
}

/** Marks silent devices offline and trims old heartbeat rows. Returns affected device ids. */
export async function sweep(pool: Pool, cfg: Config): Promise<string[]> {
  const r = await pool.query(
    `UPDATE devices SET status='offline', updated_at=now()
     WHERE status='online' AND last_seen_at < now() - make_interval(secs => $1)
     RETURNING id, serial_number`,
    [cfg.onlineThresholdSeconds],
  );
  for (const row of r.rows) await deviceLog(pool, row.id, 'went_offline', 'No heartbeat within threshold', { thresholdSeconds: cfg.onlineThresholdSeconds });
  return r.rows.map((x) => x.id);
}

export async function pruneHeartbeats(pool: Pool, cfg: Config): Promise<number> {
  const r = await pool.query(
    `DELETE FROM raw_device_requests WHERE request_kind='heartbeat'
       AND received_at < now() - make_interval(days => $1)`,
    [cfg.heartbeatRetentionDays],
  );
  return r.rowCount ?? 0;
}
