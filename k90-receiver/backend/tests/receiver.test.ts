import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { App } from '../src/app.js';
import { SimDevice } from '../src/simulator/sim.js';
import { auth, injectFetch, resetDb, startApp } from './helpers.js';
import { parseAttlog, redactBody } from '../src/protocol/iclock.js';

let app: App;
let sim: SimDevice;
const q = async (sql: string, args: unknown[] = []) => (await app.pool.query(sql, args)).rows;

beforeAll(async () => { await resetDb(); app = await startApp(); });
afterAll(async () => { await app.close(); });
beforeEach(async () => {
  await q('TRUNCATE attendance_events, raw_device_requests, device_logs, employees, devices CASCADE');
  sim = new SimDevice({ baseUrl: 'http://x', serial: 'SIM-T001', fetchImpl: injectFetch(app) });
});

describe('device registration & heartbeat', () => {
  it('registers device and returns option config', async () => {
    const r = await sim.register();
    expect(r.status).toBe(200);
    expect(r.text).toContain('GET OPTION FROM: SIM-T001');
    const d = await q('SELECT * FROM devices');
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ serial_number: 'SIM-T001', status: 'online', is_simulated: true });
    expect((await q("SELECT 1 FROM device_logs WHERE event_type='registered'")).length).toBe(1);
  });
  it('heartbeat updates last_seen, firmware, and replies OK', async () => {
    await sim.register();
    const before = (await q('SELECT last_seen_at FROM devices'))[0].last_seen_at;
    await new Promise((r) => setTimeout(r, 15));
    const r = await sim.heartbeat();
    expect(r).toEqual({ status: 200, text: 'OK' });
    const d = (await q('SELECT * FROM devices'))[0];
    expect(d.last_seen_at.getTime()).toBeGreaterThan(before.getTime());
    expect(d.firmware_version).toBe('Ver 6.60 SIM');
  });
  it('request without SN is rejected but raw request kept', async () => {
    const res = await app.fastify.inject({ method: 'GET', url: '/iclock/getrequest' });
    expect(res.statusCode).toBe(400);
    expect((await q("SELECT * FROM raw_device_requests WHERE processing_status='rejected'")).length).toBe(1);
  });
  it('sweeper marks silent device offline', async () => {
    await sim.register();
    await q("UPDATE devices SET last_seen_at = now() - interval '1 hour'");
    const { sweep } = await import('../src/services/device.js');
    const { testConfig } = await import('./helpers.js');
    await sweep(app.pool, testConfig());
    expect((await q('SELECT status FROM devices'))[0].status).toBe('offline');
  });
});

describe('attendance parsing', () => {
  it('extracts PIN, preserves device time and interprets it in DEVICE_TIMEZONE', async () => {
    await sim.register();
    const r = await sim.punch([['1001', '2025-03-04 09:15:30', '0', '1']]);
    expect(r).toEqual({ status: 200, text: 'OK' });
    const e = (await q('SELECT * FROM attendance_events'))[0];
    expect(e.employee_pin).toBe('1001');
    expect(e.attendance_time_raw).toBe('2025-03-04 09:15:30');
    expect(e.attendance_timestamp.toISOString()).toBe('2025-03-04T03:45:30.000Z'); // 09:15:30 IST
    expect(e.server_received_at.getTime()).toBeGreaterThan(Date.now() - 10_000); // receipt time is separate
    expect(e.verification_method).toBe('1');
    expect(e.punch_status).toBe('0');
    expect(e.employee_id).toBeTruthy();
  });
  it('processes multiple records per request', async () => {
    await sim.punch([['1', '2025-03-04 09:00:00'], ['2', '2025-03-04 09:00:00'], ['1', '2025-03-04 18:00:00', '1']]);
    expect(await q('SELECT 1 FROM attendance_events')).toHaveLength(3);
    expect((await q('SELECT processing_status FROM raw_device_requests WHERE request_kind=$1', ['attlog']))[0].processing_status).toBe('processed');
  });
  it('parses CRLF bodies and whitespace-separated variant', () => {
    const p = parseAttlog('7\t2025-01-01 10:00:00\t0\t1\r\n8 2025-01-01 10:01:00 0 15\r\n');
    expect(p.errors).toEqual([]);
    expect(p.records.map((r) => [r.pin, r.verify])).toEqual([['7', '1'], ['8', '15']]);
  });
});

describe('duplicates', () => {
  it('ignores a replayed request', async () => {
    await sim.punch([['1001', '2025-03-04 09:15:30']]);
    await sim.punch([['1001', '2025-03-04 09:15:30']]);
    expect(await q('SELECT 1 FROM attendance_events')).toHaveLength(1);
    expect(await q('SELECT 1 FROM raw_device_requests WHERE request_kind=$1', ['attlog'])).toHaveLength(2); // raw both kept
  });
  it('keeps distinct people with the same timestamp and same person with different status', async () => {
    await sim.punch([['1', '2025-03-04 09:00:00', '0'], ['2', '2025-03-04 09:00:00', '0'], ['1', '2025-03-04 09:00:00', '1']]);
    expect(await q('SELECT 1 FROM attendance_events')).toHaveLength(3);
  });
  it('dedups across devices separately', async () => {
    const sim2 = new SimDevice({ baseUrl: 'http://x', serial: 'SIM-T002', fetchImpl: injectFetch(app) });
    await sim.punch([['1', '2025-03-04 09:00:00']]);
    await sim2.punch([['1', '2025-03-04 09:00:00']]);
    expect(await q('SELECT 1 FROM attendance_events')).toHaveLength(2);
  });
});

describe('invalid payloads', () => {
  it('keeps raw body, stores good lines, flags bad lines, logs error', async () => {
    const r = await sim.post('/iclock/cdata?SN=SIM-T001&table=ATTLOG&Stamp=5',
      '5\t2025-03-04 09:00:00\t0\t1\nbad line\n6\t2025-02-30 00:00:00\t0\t1\n');
    expect(r.status).toBe(200);
    expect(await q('SELECT 1 FROM attendance_events')).toHaveLength(1);
    const raw = (await q("SELECT * FROM raw_device_requests WHERE request_kind='attlog'"))[0];
    expect(raw.processing_status).toBe('partial');
    expect(raw.raw_body).toContain('bad line');
    expect(JSON.parse(raw.processing_error)).toHaveLength(2);
    expect((await q("SELECT 1 FROM device_logs WHERE event_type='parse_error'")).length).toBe(1);
  });
  it('fully invalid body is marked failed, not silently dropped', async () => {
    await sim.invalid();
    const raw = (await q("SELECT * FROM raw_device_requests WHERE request_kind='attlog'"))[0];
    expect(raw.processing_status).toBe('failed');
    expect(raw.raw_body).toContain('garbage');
  });
  it('redacts biometric templates, passwords and cards from stored raw body', async () => {
    const body = 'USER PIN=9\tName=Asha\tPasswd=1234\tCard=998877\nFP PIN=9\tFID=1\tTMP=AAAABBBBCCCC\n';
    await sim.post('/iclock/cdata?SN=SIM-T001&table=OPERLOG&Stamp=1', body);
    const raw = (await q("SELECT raw_body FROM raw_device_requests WHERE request_kind='operlog'"))[0].raw_body;
    expect(raw).not.toContain('1234'); expect(raw).not.toContain('998877'); expect(raw).not.toContain('AAAABBBB');
    expect(redactBody('a\u0000b')).toBe('ab');
    expect((await q('SELECT employee_name FROM employees WHERE device_pin=$1', ['9']))[0].employee_name).toBe('Asha');
  });
  it('stores unknown endpoint carrying SN for protocol discovery, ignores scanners without SN', async () => {
    await app.fastify.inject({ method: 'GET', url: '/iclock/ping?SN=SIM-T001' });
    await app.fastify.inject({ method: 'GET', url: '/wp-login.php' });
    const rows = await q("SELECT * FROM raw_device_requests");
    expect(rows).toHaveLength(1);
    expect(rows[0].processing_status).toBe('unhandled');
  });
});

describe('API security', () => {
  it('dashboard API requires bearer token', async () => {
    for (const url of ['/api/summary', '/api/devices', '/api/attendance', '/api/attendance.csv', '/api/requests', '/api/device-logs']) {
      expect((await app.fastify.inject({ url })).statusCode).toBe(401);
      expect((await app.fastify.inject({ url, headers: { authorization: 'Bearer wrong' } })).statusCode).toBe(401);
    }
    expect((await app.fastify.inject({ url: '/api/summary', headers: auth })).statusCode).toBe(200);
  });
  it('/health is public and reports db', async () => {
    const r = await app.fastify.inject({ url: '/health' });
    expect(r.statusCode).toBe(200);
    expect(r.json().database).toBe('up');
  });
  it('allow-list rejects unlisted serials; auto-register off rejects unknown', async () => {
    const a = await startApp({ allowedDeviceSerials: ['SIM-ONLY'] });
    expect((await a.fastify.inject({ url: '/iclock/getrequest?SN=SIM-T001' })).statusCode).toBe(403);
    expect((await a.fastify.inject({ url: '/iclock/getrequest?SN=SIM-ONLY' })).statusCode).toBe(200);
    await a.close();
    const b = await startApp({ autoRegisterDevices: false });
    expect((await b.fastify.inject({ url: '/iclock/getrequest?SN=SIM-NEW1' })).statusCode).toBe(403);
    await b.close();
  });
  it('rejects SQL-ish / malformed filters and escapes CSV formulas', async () => {
    expect((await app.fastify.inject({ url: "/api/attendance?device=x'--", headers: auth })).statusCode).toBe(400);
    await sim.punch([['=cmd', '2025-03-04 09:00:00']]); // invalid PIN -> not stored
    await sim.punch([['1', '2025-03-04 09:00:00']]);
    const csv = await app.fastify.inject({ url: '/api/attendance.csv', headers: auth });
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body).toContain('"1","2025-03-04 09:00:00"');
  });
});

describe('dashboard API reflects database', () => {
  it('summary, filters, pagination, raw detail', async () => {
    await sim.register();
    await sim.punch([['1001', '2025-03-04 09:00:00'], ['1002', '2025-03-05 09:00:00'], ['1001', '2025-03-06 09:00:00']]);
    const s = (await app.fastify.inject({ url: '/api/summary', headers: auth })).json();
    expect(s).toMatchObject({ total_devices: 1, online_devices: 1, offline_devices: 0, total_events: 3 });
    const byPin = (await app.fastify.inject({ url: '/api/attendance?pin=1001', headers: auth })).json();
    expect(byPin.total).toBe(2);
    const byDate = (await app.fastify.inject({ url: '/api/attendance?from=2025-03-05&to=2025-03-05', headers: auth })).json();
    expect(byDate.events.map((e: { employee_pin: string }) => e.employee_pin)).toEqual(['1002']);
    const pg = (await app.fastify.inject({ url: '/api/attendance?pageSize=2&page=2', headers: auth })).json();
    expect(pg.events).toHaveLength(1);
    const det = (await app.fastify.inject({ url: `/api/attendance/${byPin.events[0].id}`, headers: auth })).json();
    expect(det.raw_request.raw_body).toContain('1001');
  });
});

describe('persistence, restart, DB recovery', () => {
  it('data survives app restart and dedup still holds', async () => {
    await sim.punch([['1', '2025-03-04 09:00:00']]);
    await app.close();
    app = await startApp();
    sim = new SimDevice({ baseUrl: 'http://x', serial: 'SIM-T001', fetchImpl: injectFetch(app) });
    await sim.punch([['1', '2025-03-04 09:00:00'], ['1', '2025-03-04 17:00:00']]);
    expect(await q('SELECT 1 FROM attendance_events')).toHaveLength(2);
  });
  it('recovers after all DB connections are killed', async () => {
    await sim.register();
    await q("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()").catch(() => undefined);
    let ok = false;
    for (let i = 0; i < 5 && !ok; i++) { // first call(s) may hit a dead pooled connection; device would retry
      const r = await sim.punch([['1', '2025-03-04 09:00:00']]);
      ok = r.status === 200;
    }
    expect(ok).toBe(true);
    expect(await q('SELECT 1 FROM attendance_events')).toHaveLength(1);
  });
  it('mid-batch DB failure rolls back, returns 500 (device retries), keeps raw; retry succeeds', async () => {
    await sim.register();
    await q("ALTER TABLE attendance_events ADD CONSTRAINT tmp_fail CHECK (employee_pin <> '666')");
    const lines: Array<[string, string]> = [['1', '2025-03-04 09:00:00'], ['666', '2025-03-04 09:00:01']];
    const r = await sim.punch(lines);
    expect(r.status).toBe(500);
    expect(await q('SELECT 1 FROM attendance_events')).toHaveLength(0);
    const raw = (await q("SELECT * FROM raw_device_requests WHERE request_kind='attlog'"))[0];
    expect(raw.processing_status).toBe('failed');
    expect(raw.raw_body).toContain('666');
    await q('ALTER TABLE attendance_events DROP CONSTRAINT tmp_fail');
    expect((await sim.punch(lines)).status).toBe(200);
    expect(await q('SELECT 1 FROM attendance_events')).toHaveLength(2);
  });
  it('simulated network interruption: client retries until server reachable', async () => {
    let down = true;
    const flaky = (async (u: string, i?: RequestInit) => { if (down) { down = false; throw new Error('ECONNREFUSED'); } return injectFetch(app)(u, i); }) as typeof fetch;
    const s = new SimDevice({ baseUrl: 'http://x', serial: 'SIM-T001', fetchImpl: flaky });
    const r = await s.punchWithRetry([['1', '2025-03-04 09:00:00']], 3, 5);
    expect(r.status).toBe(200);
    expect(await q('SELECT 1 FROM attendance_events')).toHaveLength(1);
  });
  it('stamp is stored; echoed on registration only when ECHO_ATTLOG_STAMP is enabled', async () => {
    await sim.punch([['1', '2025-03-04 09:00:00']], '4242');
    expect((await q('SELECT last_attlog_stamp FROM devices'))[0].last_attlog_stamp).toBe('4242');
    expect((await sim.register()).text).toContain('ATTLOGStamp=None'); // default: same as proven diagnostic reply
    const a = await startApp({ echoAttlogStamp: true });
    const s2 = new SimDevice({ baseUrl: 'http://x', serial: 'SIM-T001', fetchImpl: injectFetch(a) });
    expect((await s2.register()).text).toContain('ATTLOGStamp=4242');
    await a.close();
  });
});
