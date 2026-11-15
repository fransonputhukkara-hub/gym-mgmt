/**
 * ZKTeco/eSSL "iclock" ADMS push protocol helpers.
 *
 * STATUS: formats below follow the widely documented PUSH protocol. They are NOT yet verified against the
 * physical K90 firmware. Every request is stored raw so that real captures can confirm or correct these
 * assumptions (see docs/PROTOCOL.md and docs/VERIFICATION_CHECKLIST.md).
 */
import { createHash } from 'node:crypto';

export interface AttRecord {
  lineNo: number;
  pin: string;
  /** 'YYYY-MM-DD HH:MM:SS' device-local time, normalised, no timezone. */
  time: string;
  status: string | null;
  verify: string | null;
  workCode: string | null;
}
export interface ParseError { lineNo: number; line: string; reason: string }
export interface ParsedAttlog { records: AttRecord[]; errors: ParseError[] }

const PIN_RE = /^[A-Za-z0-9_-]{1,24}$/;
const TIME_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/;

export function normaliseDeviceTime(s: string): string | null {
  const m = TIME_RE.exec(s.trim());
  if (!m) return null;
  const [y, mo, d, h, mi, se] = m.slice(1).map(Number);
  if (y < 2000 || y > 2099) return null;
  const dt = new Date(Date.UTC(y, mo - 1, d, h, mi, se));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d ||
      dt.getUTCHours() !== h || dt.getUTCMinutes() !== mi || dt.getUTCSeconds() !== se) return null;
  return `${m[1]}-${m[2]}-${m[3]} ${m[4]}:${m[5]}:${m[6]}`;
}

const nz = (v: string | undefined): string | null => (v === undefined || v.trim() === '' ? null : v.trim());

/**
 * ATTLOG line (tab separated):  PIN \t Time \t Status \t Verify \t WorkCode \t Reserved...
 * Fallback for whitespace-separated variants:  PIN Date Time Status Verify ...
 */
export function parseAttlogLine(line: string, lineNo = 1): AttRecord | ParseError {
  let f = line.split('\t');
  if (f.length < 2) {
    const m = /^(\S+)\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})\s*(.*)$/.exec(line.trim());
    if (!m) return { lineNo, line, reason: 'unrecognised line format' };
    f = [m[1], `${m[2]} ${m[3]}`, ...(m[4] ? m[4].split(/\s+/) : [])];
  }
  const pin = f[0].trim();
  if (!PIN_RE.test(pin)) return { lineNo, line, reason: 'invalid PIN' };
  const time = normaliseDeviceTime(f[1] ?? '');
  if (!time) return { lineNo, line, reason: 'invalid timestamp' };
  return { lineNo, pin, time, status: nz(f[2]), verify: nz(f[3]), workCode: nz(f[4]) };
}

export function parseAttlog(body: string): ParsedAttlog {
  const records: AttRecord[] = [];
  const errors: ParseError[] = [];
  body.split(/\r?\n/).forEach((raw, i) => {
    if (raw.trim() === '') return;
    const r = parseAttlogLine(raw, i + 1);
    if ('reason' in r) errors.push(r); else records.push(r);
  });
  return { records, errors };
}

/**
 * Dedup strategy (no stable event id is known in ATTLOG): fingerprint over every verified field of the record.
 * Two punches only collapse if serial, PIN, second-resolution time, status, verify mode and work code are ALL
 * identical. Punches by different people, or by the same person with a different status/verify, never collapse.
 * If the physical device is later proven to send a record id, pass it as device_event_id (unique index exists).
 */
export function eventFingerprint(serial: string, r: AttRecord): string {
  return createHash('sha256')
    .update([serial, r.pin, r.time, r.status ?? '', r.verify ?? '', r.workCode ?? ''].join('|'))
    .digest('hex');
}

export interface UserRecord { pin: string; name: string | null }

/** OPERLOG/USERINFO user lines: `USER PIN=1\tName=Foo\tPri=0\tPasswd=..\tCard=..`. Only PIN and Name are kept. */
export function parseUserLines(body: string): UserRecord[] {
  const out: UserRecord[] = [];
  for (const line of body.split(/\r?\n/)) {
    if (!/^(USER|USERINFO)\s/i.test(line)) continue;
    const kv: Record<string, string> = {};
    for (const part of line.replace(/^(USER|USERINFO)\s+/i, '').split('\t')) {
      const i = part.indexOf('=');
      if (i > 0) kv[part.slice(0, i).trim().toLowerCase()] = part.slice(i + 1).trim();
    }
    if (kv.pin && PIN_RE.test(kv.pin)) out.push({ pin: kv.pin, name: kv.name ? kv.name.slice(0, 100) : null });
  }
  return out;
}

/** Strip biometric templates, passwords and card numbers before the body is persisted. */
export function redactBody(body: string): string {
  return body
    .replace(/\u0000/g, '')
    .replace(/(\b(?:TMP|Tmp|FACE|Face|BioData|PHOTO|Content|Passwd|Password|Card|Pwd)=)[^\t\r\n]*/g, '$1[REDACTED]');
}

export function redactHeaders(h: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(h)) {
    out[k] = ['authorization', 'cookie', 'proxy-authorization', 'x-api-key'].includes(k.toLowerCase()) ? '[REDACTED]' : v;
  }
  return out;
}

/** Extract firmware from the heartbeat `INFO=Ver,UserCount,FPCount,AttCount,IP,...` parameter, if present. */
export function firmwareFromInfo(info: string | undefined): string | null {
  if (!info) return null;
  const first = info.split(',')[0].trim();
  return first && first.length <= 64 ? first : null;
}

export function registrationConfig(sn: string, opts: { attlogStamp: string | null; delay: number; errorDelay: number }): string {
  return [
    `GET OPTION FROM: ${sn}`,
    `ATTLOGStamp=${opts.attlogStamp ?? 'None'}`,
    'OPERLOGStamp=None',
    'ATTPHOTOStamp=None',
    `ErrorDelay=${opts.errorDelay}`,
    `Delay=${opts.delay}`,
    'TransTimes=00:00;14:00',
    'TransInterval=1',
    'TransFlag=TransData AttLog\tOpLog',
    'Realtime=1',
    'Encrypt=None',
    '',
  ].join('\n');
}
