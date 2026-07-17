'use client';

import { useQuery } from '@tanstack/react-query';
import { AppShell } from '@/components/AppShell';
import { api } from '@/lib/api';

interface DayStat {
  day: string;
  source: 'app' | 'operator';
  total: number;
  accepted: number;
  completed: number;
  autoCancelled: number;
  avgAcceptSeconds: number | null;
}

interface StatsResponse {
  summary: {
    windowDays: number;
    total: number;
    totalApp: number;
    totalOperator: number;
    accepted: number;
    completed: number;
    autoCancelled: number;
    acceptanceRate: number;
    avgAcceptSeconds: number | null;
  };
  days: DayStat[];
}

function fmtSeconds(s: number | null): string {
  if (s === null) return '—';
  if (s < 60) return `${Math.round(s)} s`;
  return `${(s / 60).toFixed(1)} min`;
}

function fmtPct(r: number): string {
  return `${(r * 100).toFixed(1)} %`;
}

function fmtDay(iso: string): string {
  return new Date(iso).toLocaleDateString('fr-FR', { weekday: 'short', day: '2-digit', month: '2-digit' });
}

const SOURCE_LABEL: Record<'app' | 'operator', string> = {
  app: 'App',
  operator: 'Call-center',
};

export default function StatsPage() {
  const { data, isLoading, error } = useQuery<StatsResponse>({
    queryKey: ['admin-stats-operator'],
    queryFn: async () => {
      const r = await api.get<StatsResponse>('/admin/stats/operator');
      return r.data;
    },
    refetchInterval: 60_000,
  });

  return (
    <AppShell>
      <div className="p-6 max-w-6xl mx-auto">
        <h1 className="text-2xl font-bold text-slate-900 mb-1">Statistiques</h1>
        <p className="text-sm text-slate-500 mb-6">
          Activité des 7 derniers jours — répartition app vs call-center, taux
          d&apos;acceptation et temps moyen avant qu&apos;un Captain prenne la course.
        </p>

        {isLoading && <div className="text-slate-500">Chargement…</div>}
        {error && (
          <div className="card p-4 bg-red-50 border-red-200 text-sm text-red-700">
            Erreur de chargement des statistiques.
          </div>
        )}

        {data && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              <StatCard label="Courses (7 j)" value={data.summary.total.toString()} />
              <StatCard label="App" value={data.summary.totalApp.toString()}
                hint={data.summary.total ? fmtPct(data.summary.totalApp / data.summary.total) : '—'} />
              <StatCard label="Call-center" value={data.summary.totalOperator.toString()}
                hint={data.summary.total ? fmtPct(data.summary.totalOperator / data.summary.total) : '—'} />
              <StatCard label="Taux d'acceptation" value={fmtPct(data.summary.acceptanceRate)} />
              <StatCard label="Acceptées" value={data.summary.accepted.toString()} />
              <StatCard label="Terminées" value={data.summary.completed.toString()} />
              <StatCard label="Auto-annulées" value={data.summary.autoCancelled.toString()} />
              <StatCard label="Temps moyen → acceptation" value={fmtSeconds(data.summary.avgAcceptSeconds)} />
            </div>

            <h2 className="text-lg font-semibold text-slate-900 mb-2">Détail par jour</h2>
            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-slate-600 text-xs uppercase tracking-wide">
                  <tr>
                    <th className="text-left px-4 py-3 font-semibold">Jour</th>
                    <th className="text-left px-4 py-3 font-semibold">Source</th>
                    <th className="text-right px-4 py-3 font-semibold">Total</th>
                    <th className="text-right px-4 py-3 font-semibold">Acceptées</th>
                    <th className="text-right px-4 py-3 font-semibold">Terminées</th>
                    <th className="text-right px-4 py-3 font-semibold">Auto-annulées</th>
                    <th className="text-right px-4 py-3 font-semibold">Temps moyen avant acceptation</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.days.length === 0 ? (
                    <tr><td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                      Aucune course sur les 7 derniers jours.
                    </td></tr>
                  ) : data.days.map((d) => (
                    <tr key={`${d.day}-${d.source}`} className="hover:bg-slate-50">
                      <td className="px-4 py-3 whitespace-nowrap">{fmtDay(d.day)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-semibold ${d.source === 'operator' ? 'bg-violet-100 text-violet-800' : 'bg-sky-100 text-sky-800'}`}>
                          {SOURCE_LABEL[d.source]}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-medium">{d.total}</td>
                      <td className="px-4 py-3 text-right text-slate-600">{d.accepted}</td>
                      <td className="px-4 py-3 text-right text-slate-600">{d.completed}</td>
                      <td className="px-4 py-3 text-right text-slate-600">{d.autoCancelled}</td>
                      <td className="px-4 py-3 text-right text-slate-600">{fmtSeconds(d.avgAcceptSeconds)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-slate-500 uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-bold text-slate-900 mt-1">{value}</div>
      {hint && <div className="text-xs text-slate-500 mt-0.5">{hint}</div>}
    </div>
  );
}
