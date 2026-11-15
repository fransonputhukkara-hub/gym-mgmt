import type { Summary, Device } from '../api';
import { useApi } from '../hooks';
import { Card, Err, Sim } from '../components/ui';

export default function SummaryPage({ onAuth }: { onAuth: () => void }) {
  const { data: s, error } = useApi<Summary>('/api/summary', onAuth, 10_000);
  const { data: d } = useApi<{ devices: Device[] }>('/api/devices', onAuth, 10_000);
  if (error) return <Err msg={error} />;
  if (!s) return <p>Loading…</p>;
  const lp = s.latest_punch;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Card title="Registered devices" value={s.total_devices} />
        <Card title="Online" value={s.online_devices} />
        <Card title="Offline" value={s.offline_devices} />
        <Card title="Total events" value={s.total_events} />
        <Card title={`Today (${s.timezone})`} value={s.today_events} />
      </div>
      <Card title="Latest received punch"
        value={lp ? <>PIN {lp.employee_pin}{lp.is_simulated && <Sim />}</> : 'None yet'}
        sub={lp && `device time ${lp.attendance_time_raw} · ${lp.serial_number}`} />
      {d && !d.devices.some((x) => !x.is_simulated) && (
        <div className="rounded border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          No physical device has connected yet. Any data above is from the protocol simulator and is not hardware proof.
        </div>
      )}
    </div>
  );
}
