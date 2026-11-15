const KEY = 'k90_token';
export const getToken = () => { try { return sessionStorage.getItem(KEY) ?? ''; } catch { return ''; } };
export const setToken = (t: string) => { try { t ? sessionStorage.setItem(KEY, t) : sessionStorage.removeItem(KEY); } catch { /* ignore */ } };

export class AuthError extends Error {}

export async function api<T>(path: string): Promise<T> {
  const res = await fetch(path, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (res.status === 401) throw new AuthError('unauthorized');
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

export async function downloadCsv(query: string) {
  const res = await fetch(`/api/attendance.csv?${query}`, { headers: { Authorization: `Bearer ${getToken()}` } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a'); a.href = url; a.download = 'attendance.csv'; a.click();
  URL.revokeObjectURL(url);
}

/** Verification codes are shown as sent by the device. The label is a PROVISIONAL common-ZK mapping, not verified for K90. */
const VERIFY: Record<string, string> = { '0': 'Password', '1': 'Fingerprint', '2': 'Card', '15': 'Face' };
export const verifyLabel = (v: string | null) => (v === null ? '—' : VERIFY[v] ? `${v} · ${VERIFY[v]}?` : v);

export interface Device { id: string; serial_number: string; model: string | null; firmware_version: string | null; ip_address: string | null;
  last_seen_at: string | null; registered_at: string; is_simulated: boolean; online: boolean; last_event_at: string | null; event_count: number }
export interface AttEvent { id: string; employee_pin: string; employee_name: string | null; attendance_time_raw: string; server_received_at: string;
  verification_method: string | null; punch_status: string | null; serial_number: string; is_simulated: boolean; device_id: string }
export interface Summary { total_devices: number; online_devices: number; offline_devices: number; total_events: number; today_events: number;
  latest_punch: { employee_pin: string; attendance_time_raw: string; serial_number: string; is_simulated: boolean } | null; timezone: string }
export interface RawReq { id: string; serial_number: string | null; request_kind: string; endpoint: string; http_method: string; source_ip: string | null;
  received_at: string; processing_status: string; processing_error: string | null; raw_body: string; is_simulated: boolean | null }
export interface DevLog { id: string; event_type: string; message: string; created_at: string; serial_number: string | null }
