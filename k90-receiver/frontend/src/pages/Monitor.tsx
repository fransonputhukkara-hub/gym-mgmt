import { Fragment, useState } from 'react';
import type { DevLog, RawReq } from '../api';
import { useApi } from '../hooks';
import { Err, fmt, Sim, Table, Td, Th } from '../components/ui';

export default function MonitorPage({ onAuth }: { onAuth: () => void }) {
  const [hideHb, setHideHb] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const { data, error } = useApi<{ requests: RawReq[] }>(`/api/requests?limit=100${hideHb ? '&hideHeartbeats=1' : ''}`, onAuth, 5_000);
  const { data: logs } = useApi<{ logs: DevLog[] }>('/api/device-logs?limit=50', onAuth, 10_000);
  const tone = (s: string) => (s === 'processed' ? 'text-emerald-700' : s === 'partial' || s === 'unhandled' ? 'text-amber-700' : 'text-red-700');
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold">Incoming device requests</h2>
          <label className="text-sm"><input type="checkbox" checked={hideHb} onChange={(e) => setHideHb(e.target.checked)} /> hide heartbeats</label>
        </div>
        {error && <Err msg={error} />}
        <Table>
          <thead><tr><Th>Received</Th><Th>Device</Th><Th>Kind</Th><Th>Method</Th><Th>Endpoint</Th><Th>Status</Th><Th>Error</Th></tr></thead>
          <tbody>
            {data?.requests.map((r) => (
              <Fragment key={r.id}>
                <tr className="cursor-pointer hover:bg-slate-50" onClick={() => setOpen(open === r.id ? null : r.id)}>
                  <Td>{fmt(r.received_at)}</Td>
                  <Td className="font-mono">{r.serial_number ?? '—'}{r.is_simulated && <Sim />}</Td>
                  <Td>{r.request_kind}</Td><Td>{r.http_method}</Td>
                  <Td className="max-w-xs truncate font-mono text-xs">{r.endpoint}</Td>
                  <Td className={tone(r.processing_status)}>{r.processing_status}</Td>
                  <Td className="max-w-xs truncate text-xs">{r.processing_error ?? ''}</Td>
                </tr>
                {open === r.id && <tr><Td className="bg-slate-50"><pre className="whitespace-pre-wrap break-all text-xs">{r.raw_body || '(empty body)'}{r.processing_error ? `\n\nERROR: ${r.processing_error}` : ''}</pre></Td></tr>}
              </Fragment>
            ))}
          </tbody>
        </Table>
      </section>
      <section className="space-y-2">
        <h2 className="font-semibold">Device communication history</h2>
        <Table>
          <thead><tr><Th>Time</Th><Th>Device</Th><Th>Event</Th><Th>Message</Th></tr></thead>
          <tbody>
            {logs?.logs.map((l) => <tr key={l.id}><Td>{fmt(l.created_at)}</Td><Td className="font-mono">{l.serial_number ?? '—'}</Td><Td>{l.event_type}</Td><Td>{l.message}</Td></tr>)}
          </tbody>
        </Table>
      </section>
    </div>
  );
}
