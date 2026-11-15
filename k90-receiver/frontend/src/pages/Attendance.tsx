import { useState } from 'react';
import { downloadCsv, verifyLabel, type AttEvent, type Device } from '../api';
import { api } from '../api';
import { useApi } from '../hooks';
import { Btn, Err, fmt, Sim, Table, Td, Th } from '../components/ui';

interface Detail { event: AttEvent; raw_request: { endpoint: string; http_method: string; received_at: string; raw_body: string; processing_status: string; processing_error: string | null; headers_json: unknown } | null }

export default function AttendancePage({ onAuth }: { onAuth: () => void }) {
  const [pin, setPin] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const [device, setDevice] = useState(''); const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<Detail | null>(null);
  const qs = new URLSearchParams({ page: String(page), pageSize: '25', ...(pin && { pin }), ...(from && { from }), ...(to && { to }), ...(device && { device }) });
  const csvQs = new URLSearchParams({ ...(pin && { pin }), ...(from && { from }), ...(to && { to }), ...(device && { device }) }).toString();
  const { data, error } = useApi<{ total: number; pageSize: number; events: AttEvent[] }>(`/api/attendance?${qs}`, onAuth, 15_000);
  const { data: devs } = useApi<{ devices: Device[] }>('/api/devices', onAuth);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const reset = <T,>(set: (v: T) => void) => (v: T) => { set(v); setPage(1); };
  const inp = 'rounded border border-slate-300 bg-white px-2 py-1.5 text-sm';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <input className={inp} placeholder="Employee PIN" value={pin} onChange={(e) => reset(setPin)(e.target.value)} aria-label="Employee PIN" />
        <input className={inp} type="date" value={from} onChange={(e) => reset(setFrom)(e.target.value)} aria-label="From date" />
        <input className={inp} type="date" value={to} onChange={(e) => reset(setTo)(e.target.value)} aria-label="To date" />
        <select className={inp} value={device} onChange={(e) => reset(setDevice)(e.target.value)} aria-label="Device">
          <option value="">All devices</option>
          {devs?.devices.map((d) => <option key={d.id} value={d.id}>{d.serial_number}</option>)}
        </select>
        <Btn onClick={() => void downloadCsv(csvQs).catch((e) => alert(e.message))}>Export CSV</Btn>
      </div>
      {error && <Err msg={error} />}
      <Table>
        <thead><tr><Th>Employee PIN</Th><Th>Date</Th><Th>Time</Th><Th>Verification</Th><Th>Status code</Th><Th>Device</Th><Th>Received</Th><Th>Raw</Th></tr></thead>
        <tbody>
          {data?.events.map((e) => {
            const [date, time] = e.attendance_time_raw.split(' ');
            return (
              <tr key={e.id}>
                <Td className="font-mono">{e.employee_pin}{e.employee_name && <span className="ml-1 text-slate-500">({e.employee_name})</span>}</Td>
                <Td>{date}</Td><Td>{time}</Td><Td>{verifyLabel(e.verification_method)}</Td><Td>{e.punch_status ?? '—'}</Td>
                <Td className="font-mono">{e.serial_number}{e.is_simulated && <Sim />}</Td><Td>{fmt(e.server_received_at)}</Td>
                <Td><button className="text-blue-700 underline" onClick={() => void api<Detail>(`/api/attendance/${e.id}`).then(setDetail)}>view</button></Td>
              </tr>
            );
          })}
          {data?.events.length === 0 && <tr><Td className="text-slate-500">No events match.</Td></tr>}
        </tbody>
      </Table>
      <div className="flex items-center gap-3 text-sm">
        <Btn disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</Btn>
        <span>Page {page} / {pages} · {data?.total ?? 0} events</span>
        <Btn disabled={page >= pages} onClick={() => setPage(page + 1)}>Next</Btn>
      </div>
      <p className="text-xs text-slate-500">Date/time = device clock as sent. Verification labels marked “?” are a provisional common mapping, unverified for K90.</p>
      {detail && (
        <div className="fixed inset-0 z-10 flex items-center justify-center bg-black/40 p-4" onClick={() => setDetail(null)}>
          <div className="max-h-[85vh] w-full max-w-2xl overflow-auto rounded-lg bg-white p-4" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex justify-between"><h2 className="font-semibold">Raw event</h2><button onClick={() => setDetail(null)}>✕</button></div>
            <pre className="whitespace-pre-wrap break-all rounded bg-slate-100 p-2 text-xs">{JSON.stringify(detail, null, 2)}</pre>
          </div>
        </div>
      )}
    </div>
  );
}
