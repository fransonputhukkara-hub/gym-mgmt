import { useCallback, useState } from 'react';
import { getToken, setToken } from './api';
import { Btn } from './components/ui';
import SummaryPage from './pages/Summary';
import DevicesPage from './pages/Devices';
import AttendancePage from './pages/Attendance';
import MonitorPage from './pages/Monitor';

const TABS = ['Summary', 'Devices', 'Attendance', 'Monitor'] as const;
type Tab = (typeof TABS)[number];

export default function App() {
  const [token, setTok] = useState(getToken());
  const [tab, setTab] = useState<Tab>('Summary');
  const [draft, setDraft] = useState('');
  const logout = useCallback(() => { setToken(''); setTok(''); }, []);

  if (!token) {
    return (
      <form className="mx-auto mt-24 w-full max-w-sm space-y-3 px-4" onSubmit={(e) => { e.preventDefault(); setToken(draft); setTok(draft); }}>
        <h1 className="text-xl font-semibold">K90 Attendance Receiver</h1>
        <input type="password" autoFocus className="w-full rounded border border-slate-300 px-3 py-2" placeholder="Dashboard token" value={draft} onChange={(e) => setDraft(e.target.value)} />
        <Btn type="submit" className="w-full">Sign in</Btn>
      </form>
    );
  }
  const P = { Summary: SummaryPage, Devices: DevicesPage, Attendance: AttendancePage, Monitor: MonitorPage }[tab];
  return (
    <div className="mx-auto max-w-6xl px-4 py-4">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <nav className="flex gap-1">
          {TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`rounded px-3 py-1.5 text-sm ${t === tab ? 'bg-slate-900 text-white' : 'bg-white border border-slate-200'}`}>{t}</button>
          ))}
        </nav>
        <button className="text-sm text-slate-600 underline" onClick={logout}>Sign out</button>
      </header>
      <P onAuth={logout} />
    </div>
  );
}
