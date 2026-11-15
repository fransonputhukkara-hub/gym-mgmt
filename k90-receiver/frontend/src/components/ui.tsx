import type { ReactNode } from 'react';

export const Sim = () => <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-800">SIMULATED</span>;
export const fmt = (s: string | null) => (s ? new Date(s).toLocaleString() : '—');

export function Card({ title, value, sub }: { title: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{title}</div>
      <div className="mt-1 text-2xl font-semibold">{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

export function Badge({ ok, children }: { ok: boolean; children: ReactNode }) {
  return <span className={`rounded px-2 py-0.5 text-xs font-medium ${ok ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-700'}`}>{children}</span>;
}

export const Table = ({ children }: { children: ReactNode }) => (
  <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white"><table className="w-full text-left text-sm">{children}</table></div>
);
export const Th = ({ children }: { children: ReactNode }) => <th className="whitespace-nowrap bg-slate-100 px-3 py-2 text-xs font-semibold uppercase text-slate-600">{children}</th>;
export const Td = ({ children, className = '' }: { children: ReactNode; className?: string }) => <td className={`border-t border-slate-100 px-3 py-2 ${className}`}>{children}</td>;
export const Err = ({ msg }: { msg: string }) => <div className="rounded border border-red-200 bg-red-50 p-3 text-sm text-red-700">{msg}</div>;
export const Btn = (p: React.ButtonHTMLAttributes<HTMLButtonElement>) =>
  <button {...p} className={`rounded bg-slate-900 px-3 py-1.5 text-sm text-white hover:bg-slate-700 disabled:opacity-40 ${p.className ?? ''}`} />;
