/**
 * Fixtures copied from real requests captured by the k90-diagnostic service on 2026-11-15/17 from the physical
 * K90 (serial NFZ8235001760). Only the request path, method and body were captured; query strings were NOT, so
 * the query parameters used below (table, Stamp) are still assumptions.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { App } from '../src/app.js';
import { parseAttlog } from '../src/protocol/iclock.js';
import { resetDb, startApp } from './helpers.js';

const SN = 'NFZ8235001760';
// Verbatim body of a captured upload (10 tab-separated fields, trailing tab). Backlog batch of 7 punches.
const BACKLOG =
  '1\t2026-11-15 01:07:17\t0\t2\t0\t\t\t0\t0\t\n1\t2026-11-15 01:07:38\t0\t2\t0\t\t\t0\t0\t\n' +
  '1\t2026-11-15 01:26:13\t0\t2\t0\t\t\t0\t0\t\n1\t2026-11-15 01:29:55\t0\t2\t0\t\t\t0\t0\t\n' +
  '1\t2026-11-15 01:29:57\t0\t2\t0\t\t\t0\t0\t\n1\t2026-11-15 01:30:01\t0\t2\t0\t\t\t0\t0\t\n' +
  '1\t2026-11-15 02:23:01\t0\t2\t0\t\t\t0\t0\t\n';
const SINGLE = '1\t2026-11-15 14:55:24\t0\t2\t0\t\t\t0\t0\t\n';
const OPLOG = 'OPLOG 4\t0\t2026-11-15 14:59:03\t0\t0\t0\t0\n';

let app: App;
const q = async (sql: string, a: unknown[] = []) => (await app.pool.query(sql, a)).rows;
const get = (url: string) => app.fastify.inject({ method: 'GET', url });
const post = (url: string, payload: string) => app.fastify.inject({ method: 'POST', url, payload, headers: { 'content-type': 'text/plain' } });

beforeAll(async () => { await resetDb(); app = await startApp(); });
afterAll(async () => { await app.close(); });
beforeEach(async () => { await q('TRUNCATE attendance_events, raw_device_requests, device_logs, employees, devices CASCADE'); });

describe('real K90 captures (.aspx paths)', () => {
  it('parses the real attendance line layout', () => {
    const p = parseAttlog(BACKLOG);
    expect(p.errors).toEqual([]);
    expect(p.records).toHaveLength(7);
    expect(p.records[0]).toMatchObject({ pin: '1', time: '2026-11-15 01:07:17', status: '0', verify: '2', workCode: '0' });
  });

  it('heartbeat on /iclock/getrequest.aspx is recognised as heartbeat', async () => {
    const r = await get(`/iclock/getrequest.aspx?SN=${SN}`);
    expect(r.statusCode).toBe(200);
    expect((await q("SELECT request_kind FROM raw_device_requests"))[0].request_kind).toBe('heartbeat');
    expect((await q('SELECT status FROM devices'))[0].status).toBe('online');
  });

  it('registration on /iclock/cdata.aspx is recognised', async () => {
    const r = await get(`/iclock/cdata.aspx?SN=${SN}&options=all`);
    expect(r.body).toContain(`GET OPTION FROM: ${SN}`);
    expect((await q("SELECT request_kind FROM raw_device_requests"))[0].request_kind).toBe('registration');
  });

  it('stores a real delayed backlog batch, keeps rapid punches, preserves device time (IST)', async () => {
    const r = await post(`/iclock/cdata.aspx?SN=${SN}&table=ATTLOG&Stamp=1`, BACKLOG);
    expect(r.body).toBe('OK');
    const ev = await q('SELECT * FROM attendance_events ORDER BY attendance_timestamp');
    expect(ev).toHaveLength(7);
    expect(ev[0].attendance_time_raw).toBe('2026-11-15 01:07:17');
    expect(ev[0].attendance_timestamp.toISOString()).toBe('2026-11-14T19:37:17.000Z'); // 01:07:17 IST
    expect(ev[0]).toMatchObject({ employee_pin: '1', verification_method: '2', punch_status: '0', work_code: '0' });
    expect((await q("SELECT request_kind, processing_status FROM raw_device_requests"))[0])
      .toEqual({ request_kind: 'attlog', processing_status: 'processed' });
  });

  it('real single punch re-sent is stored once', async () => {
    await post(`/iclock/cdata.aspx?SN=${SN}&table=ATTLOG&Stamp=2`, SINGLE);
    await post(`/iclock/cdata.aspx?SN=${SN}&table=ATTLOG&Stamp=2`, SINGLE);
    expect(await q('SELECT 1 FROM attendance_events')).toHaveLength(1);
  });

  it('real OPLOG body is stored raw and acknowledged, creating no attendance', async () => {
    const r = await post(`/iclock/cdata.aspx?SN=${SN}&table=OPERLOG&Stamp=3`, OPLOG);
    expect(r.body).toBe('OK');
    expect(await q('SELECT 1 FROM attendance_events')).toHaveLength(0);
    expect((await q("SELECT raw_body FROM raw_device_requests"))[0].raw_body).toBe(OPLOG);
  });
});
