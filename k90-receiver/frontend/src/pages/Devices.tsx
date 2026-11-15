import type { Device } from '../api';
import { useApi } from '../hooks';
import { Badge, Err, fmt, Sim, Table, Td, Th } from '../components/ui';

export default function DevicesPage({ onAuth }: { onAuth: () => void }) {
  const { data, error } = useApi<{ devices: Device[] }>('/api/devices', onAuth, 10_000);
  if (error) return <Err msg={error} />;
  if (!data) return <p>Loading…</p>;
  return (
    <Table>
      <thead><tr><Th>Serial</Th><Th>Model</Th><Th>Firmware</Th><Th>Status</Th><Th>Last heartbeat</Th><Th>Last event</Th><Th>Events</Th><Th>IP seen</Th><Th>Registered</Th></tr></thead>
      <tbody>
        {data.devices.map((d) => (
          <tr key={d.id}>
            <Td className="font-mono">{d.serial_number}{d.is_simulated && <Sim />}</Td>
            <Td>{d.model ?? '—'}</Td><Td>{d.firmware_version ?? '—'}</Td>
            <Td><Badge ok={d.online}>{d.online ? 'Online' : 'Offline'}</Badge></Td>
            <Td>{fmt(d.last_seen_at)}</Td><Td>{fmt(d.last_event_at)}</Td><Td>{d.event_count}</Td>
            <Td>{d.ip_address ?? '—'}</Td><Td>{fmt(d.registered_at)}</Td>
          </tr>
        ))}
        {data.devices.length === 0 && <tr><Td className="text-slate-500">No devices registered yet.</Td></tr>}
      </tbody>
    </Table>
  );
}
