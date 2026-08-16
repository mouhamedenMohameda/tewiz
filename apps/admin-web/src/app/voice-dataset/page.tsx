'use client';

/**
 * Voice-dataset console.
 *
 * Three jobs, in the order they matter:
 *
 *  1. COVERAGE — which stratification buckets are still starved. Collection is
 *     stratified per axis, so a bucket at zero means an entire class of speech
 *     (round trips, street noise, ambiguous names) is untested and any accuracy
 *     figure computed from the corpus is silent about it.
 *  2. REVIEW — nothing enters an evaluation split unlistened. A wrong gold
 *     label caps the measured accuracy of every architecture scored against the
 *     corpus, invisibly and permanently.
 *  3. EXPORT — manifest plus audio, ready for the evaluation harness.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import clsx from 'clsx';
import { AppShell } from '@/components/AppShell';
import { api, fetchBlobUrl } from '@/lib/api';
import { AXIS_LABELS, scenarioSummary } from './labels';
import type { Coverage, DatasetSample, SampleStatus, Tester } from './types';

const BASE = '/admin/voice-dataset';

/**
 * Default samples wanted per axis value.
 *
 * At 20 per bucket a per-bucket accuracy figure has a confidence interval of
 * roughly ±10 points — coarse, but enough to see which bucket is the outlier,
 * which is what per-bucket numbers are for. The headline figure across the
 * whole corpus is far tighter than any single bucket.
 */
const DEFAULT_TARGET = 20;

const STATUS_TABS: { value: SampleStatus | 'all'; label: string }[] = [
  { value: 'collected', label: 'À relire' },
  { value: 'validated', label: 'Validés' },
  { value: 'rejected', label: 'Rejetés' },
  { value: 'all', label: 'Tous' },
];

const STATUS_BADGE: Record<SampleStatus, string> = {
  collected: 'badge-pending',
  validated: 'badge-approved',
  rejected: 'badge-rejected',
};

function fmtDuration(sec: number | null): string {
  if (!sec) return '—';
  return sec >= 60 ? `${Math.floor(sec / 60)}m${String(sec % 60).padStart(2, '0')}` : `${sec}s`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
}

/** Trigger a browser download for an authenticated endpoint. */
async function downloadAuthed(path: string, filename: string): Promise<void> {
  const url = await fetchBlobUrl(path);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revoking immediately can cancel the download in some browsers; one tick
  // after the click is enough for the fetch to have been handed off.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function VoiceDatasetPage() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<SampleStatus | 'all'>('collected');
  const [target, setTarget] = useState(DEFAULT_TARGET);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const coverage = useQuery({
    queryKey: ['voice-dataset', 'coverage'],
    queryFn: async () => (await api.get<Coverage>(`${BASE}/coverage`)).data,
  });

  const samples = useQuery({
    queryKey: ['voice-dataset', 'samples', statusFilter],
    queryFn: async () => {
      const params = statusFilter === 'all' ? {} : { status: statusFilter };
      const r = await api.get<{ items: DatasetSample[]; total: number }>(
        `${BASE}/samples`,
        { params: { ...params, limit: 100 } },
      );
      return r.data;
    },
  });

  const testers = useQuery({
    queryKey: ['voice-dataset', 'testers'],
    queryFn: async () => (await api.get<Tester[]>(`${BASE}/testers`)).data,
  });

  const review = useMutation({
    mutationFn: async (input: { id: string; status: 'validated' | 'rejected'; note?: string }) => {
      await api.post(`${BASE}/samples/${input.id}/review`, {
        status: input.status,
        note: input.note ?? null,
      });
    },
    onSuccess: () => {
      setSelectedId(null);
      void qc.invalidateQueries({ queryKey: ['voice-dataset'] });
    },
  });

  const runSplit = useCallback(async () => {
    setBusy(true);
    try {
      const r = await api.post<{ dev: number; test: number }>(`${BASE}/split`, {});
      alert(`Répartition effectuée : ${r.data.dev} en dev, ${r.data.test} en test.`);
      void qc.invalidateQueries({ queryKey: ['voice-dataset'] });
    } catch {
      alert('Échec de la répartition.');
    } finally {
      setBusy(false);
    }
  }, [qc]);

  return (
    <AppShell>
      <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-6">
        <header>
          <h1 className="text-2xl font-semibold text-slate-900">Jeu de données vocal</h1>
          <p className="text-sm text-slate-500 mt-1">
            Corpus de référence pour mesurer la compréhension du hassaniya.
            {coverage.data ? ` ${coverage.data.total} échantillon(s) exploitables.` : ''}
          </p>
        </header>

        <CoverageSection coverage={coverage.data} target={target} onTarget={setTarget} />

        <ExportSection busy={busy} onSplit={runSplit} />

        <ReviewSection
          samples={samples.data?.items ?? []}
          loading={samples.isLoading}
          statusFilter={statusFilter}
          onStatusFilter={setStatusFilter}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onReview={(id, status, note) => review.mutate({ id, status, note })}
          reviewing={review.isPending}
        />

        <TestersSection
          testers={testers.data ?? []}
          onRevoke={async (id) => {
            await api.post(`${BASE}/testers/${id}`, { isTester: false });
            void qc.invalidateQueries({ queryKey: ['voice-dataset', 'testers'] });
          }}
          onGrant={async (id) => {
            await api.post(`${BASE}/testers/${id}`, { isTester: true });
            void qc.invalidateQueries({ queryKey: ['voice-dataset', 'testers'] });
          }}
        />
      </div>
    </AppShell>
  );
}

// ── Coverage ─────────────────────────────────────────────────────────────────

function CoverageSection({ coverage, target, onTarget }: {
  coverage: Coverage | undefined;
  target: number;
  onTarget: (n: number) => void;
}) {
  const gaps = useMemo(() => {
    if (!coverage) return 0;
    return AXIS_LABELS.reduce(
      (sum, axis) => sum + coverage[axis.key].filter((b) => b.count < target).length,
      0,
    );
  }, [coverage, target]);

  return (
    <section className="card p-4 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="font-semibold text-slate-900">Couverture par axe</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Comptée par axe (marginale), pas par combinaison : l&apos;espace joint fait
            2880 cases, qu&apos;aucun corpus réaliste ne remplit.
          </p>
        </div>
        <label className="text-sm text-slate-600 flex items-center gap-2">
          Objectif / valeur
          <input
            type="number"
            min={1}
            max={200}
            value={target}
            onChange={(e) => onTarget(Math.max(1, Number(e.target.value) || 1))}
            className="input w-20"
          />
        </label>
      </div>

      {gaps > 0 ? (
        <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
          {gaps} valeur(s) sous l&apos;objectif. Les consignes envoyées aux testeurs
          ciblent automatiquement les moins couvertes.
        </p>
      ) : coverage ? (
        <p className="text-sm text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2 mb-4">
          Tous les axes atteignent l&apos;objectif de {target} échantillons.
        </p>
      ) : null}

      <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
        {AXIS_LABELS.map((axis) => (
          <div key={axis.key}>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
              {axis.title}
            </h3>
            <div className="space-y-1.5">
              {(coverage?.[axis.key] ?? []).map((bucket) => {
                const pct = Math.min(100, (bucket.count / target) * 100);
                return (
                  <div key={bucket.value} className="flex items-center gap-2">
                    <span className="text-xs text-slate-600 w-32 shrink-0 truncate">
                      {axis.labels[bucket.value] ?? bucket.value}
                    </span>
                    <div className="flex-1 h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className={clsx(
                          'h-full rounded-full',
                          bucket.count === 0 ? 'bg-red-400'
                            : bucket.count < target ? 'bg-amber-400'
                              : 'bg-green-500',
                        )}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <span className={clsx(
                      'text-xs tabular-nums w-10 text-right',
                      bucket.count === 0 ? 'text-red-600 font-medium' : 'text-slate-500',
                    )}>
                      {bucket.count}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ── Export ───────────────────────────────────────────────────────────────────

function ExportSection({ busy, onSplit }: { busy: boolean; onSplit: () => void }) {
  const [split, setSplit] = useState<'' | 'dev' | 'test'>('');
  const suffix = split ? `?split=${split}` : '';
  const name = split || 'all';

  return (
    <section className="card p-4 md:p-5">
      <h2 className="font-semibold text-slate-900 mb-1">Export</h2>
      <p className="text-xs text-slate-500 mb-4">
        Échantillons validés uniquement. L&apos;archive contient
        <code className="mx-1">manifest.jsonl</code> et <code className="mx-1">audio/</code>.
        Aucune position GPS n&apos;est stockée : le harness la dérive du POI de départ
        avec 300-800 m de bruit.
      </p>

      <div className="flex flex-wrap items-center gap-2">
        <select
          value={split}
          onChange={(e) => setSplit(e.target.value as '' | 'dev' | 'test')}
          className="input w-auto"
        >
          <option value="">Tout le corpus</option>
          <option value="dev">Split dev</option>
          <option value="test">Split test (holdout)</option>
        </select>

        <button
          className="btn-secondary"
          onClick={() => downloadAuthed(`${BASE}/export.jsonl${suffix}`, `voice-dataset-${name}.jsonl`)}
        >
          Manifest JSONL
        </button>
        <button
          className="btn-primary"
          onClick={() => downloadAuthed(`${BASE}/export.tar${suffix}`, `voice-dataset-${name}.tar`)}
        >
          Archive complète (.tar)
        </button>

        <div className="flex-1" />

        <button className="btn-secondary" disabled={busy} onClick={onSplit}>
          {busy ? 'Répartition…' : 'Répartir dev / test'}
        </button>
      </div>

      <p className="text-xs text-slate-500 mt-3">
        La répartition groupe <strong>par testeur</strong> : une même voix ne peut pas
        se retrouver des deux côtés, sinon le score de test mesure en partie la
        mémorisation du locuteur plutôt que la généralisation. Un split déjà
        attribué n&apos;est jamais réattribué.
      </p>
    </section>
  );
}

// ── Review ───────────────────────────────────────────────────────────────────

function ReviewSection({
  samples, loading, statusFilter, onStatusFilter, selectedId, onSelect, onReview, reviewing,
}: {
  samples: DatasetSample[];
  loading: boolean;
  statusFilter: SampleStatus | 'all';
  onStatusFilter: (s: SampleStatus | 'all') => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onReview: (id: string, status: 'validated' | 'rejected', note?: string) => void;
  reviewing: boolean;
}) {
  return (
    <section className="card p-4 md:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="font-semibold text-slate-900">Relecture</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            Écoutez avant de valider : une étiquette fausse plafonne silencieusement
            la précision mesurée de toutes les architectures testées.
          </p>
        </div>
        <div className="flex gap-1">
          {STATUS_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => onStatusFilter(tab.value)}
              className={clsx(
                'px-3 py-1.5 rounded-lg text-sm font-medium transition',
                statusFilter === tab.value
                  ? 'bg-brand-600 text-white'
                  : 'text-slate-600 hover:bg-slate-100',
              )}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-slate-400 py-6 text-center">Chargement…</p>
      ) : samples.length === 0 ? (
        <p className="text-sm text-slate-400 py-6 text-center">Aucun échantillon.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {samples.map((sample) => (
            <SampleRow
              key={sample.id}
              sample={sample}
              expanded={selectedId === sample.id}
              onToggle={() => onSelect(selectedId === sample.id ? null : sample.id)}
              onReview={onReview}
              reviewing={reviewing}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function SampleRow({ sample, expanded, onToggle, onReview, reviewing }: {
  sample: DatasetSample;
  expanded: boolean;
  onToggle: () => void;
  onReview: (id: string, status: 'validated' | 'rejected', note?: string) => void;
  reviewing: boolean;
}) {
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [note, setNote] = useState('');

  // Fetch the clip only when the row is opened — a hundred authenticated audio
  // requests on mount would be most of the page's bandwidth for clips nobody
  // plays. Revoked on collapse so object URLs don't accumulate over a review
  // session.
  useEffect(() => {
    if (!expanded) return;
    let url: string | null = null;
    let cancelled = false;
    fetchBlobUrl(`${BASE}/samples/${sample.id}/audio`)
      .then((u) => {
        url = u;
        if (cancelled) URL.revokeObjectURL(u);
        else setAudioUrl(u);
      })
      .catch(() => setAudioUrl(null));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
      setAudioUrl(null);
    };
  }, [expanded, sample.id]);

  const route = sample.isOpen
    ? 'Course ouverte'
    : [sample.pickup?.label, sample.destination?.label].filter(Boolean).join(' → ') || '—';

  return (
    <li className="py-3">
      <button onClick={onToggle} className="w-full text-left flex items-center gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-slate-900 truncate">{route}</span>
            <span className={STATUS_BADGE[sample.status]}>{sample.status}</span>
            {sample.split ? <span className="badge-info">{sample.split}</span> : null}
          </div>
          <p className="text-xs text-slate-500 mt-0.5 truncate">
            {scenarioSummary(sample.scenario)}
          </p>
        </div>
        <span className="text-xs text-slate-400 shrink-0">
          {fmtDuration(sample.audioDurationS)} · {fmtDate(sample.createdAt)}
        </span>
      </button>

      {expanded ? (
        <div className="mt-3 pl-1 space-y-3">
          {audioUrl ? (
            <audio controls src={audioUrl} className="w-full max-w-md" />
          ) : (
            <p className="text-xs text-slate-400">Chargement de l&apos;audio…</p>
          )}

          <dl className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
            <div>
              <dt className="text-xs text-slate-500">Départ</dt>
              <dd className="text-slate-900">{sample.pickup?.label ?? '—'}</dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Destination</dt>
              <dd className="text-slate-900">
                {sample.isOpen ? 'Course ouverte' : sample.destination?.label ?? '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Locuteur</dt>
              <dd className="text-slate-900">
                {[sample.speaker.gender, sample.speaker.ageBand].filter(Boolean).join(' · ') || '—'}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-slate-500">Transcription</dt>
              <dd className="text-slate-900" dir="auto">{sample.transcriptGold ?? '—'}</dd>
            </div>
          </dl>

          {sample.status === 'collected' ? (
            <div className="flex flex-wrap items-center gap-2">
              <input
                className="input flex-1 min-w-48"
                placeholder="Motif (si rejet)"
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <button
                className="btn-primary"
                disabled={reviewing}
                onClick={() => onReview(sample.id, 'validated', note || undefined)}
              >
                Valider
              </button>
              <button
                className="btn-danger"
                disabled={reviewing}
                onClick={() => onReview(sample.id, 'rejected', note || undefined)}
              >
                Rejeter
              </button>
            </div>
          ) : sample.reviewNote ? (
            <p className="text-xs text-slate-500">Motif : {sample.reviewNote}</p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

// ── Testers ──────────────────────────────────────────────────────────────────

function TestersSection({ testers, onGrant, onRevoke }: {
  testers: Tester[];
  onGrant: (userId: string) => Promise<void>;
  onRevoke: (userId: string) => Promise<void>;
}) {
  const [userId, setUserId] = useState('');
  const [granting, setGranting] = useState(false);

  const grant = async () => {
    const id = userId.trim();
    if (!id) return;
    setGranting(true);
    try {
      await onGrant(id);
      setUserId('');
    } catch {
      alert('Utilisateur introuvable.');
    } finally {
      setGranting(false);
    }
  };

  return (
    <section className="card p-4 md:p-5">
      <h2 className="font-semibold text-slate-900 mb-1">Testeurs</h2>
      <p className="text-xs text-slate-500 mb-4">
        Le droit de collecte est un simple indicateur sur le compte, pas un rôle.
        Il est relu à chaque appel : une révocation prend effet immédiatement,
        sans attendre la prochaine connexion.
      </p>

      <div className="flex flex-wrap gap-2 mb-4">
        <input
          className="input flex-1 min-w-64"
          placeholder="ID utilisateur (UUID) à autoriser"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
        />
        <button className="btn-primary" disabled={granting || !userId.trim()} onClick={grant}>
          Autoriser
        </button>
      </div>

      {testers.length === 0 ? (
        <p className="text-sm text-slate-400 py-4 text-center">Aucun testeur autorisé.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {testers.map((tester) => (
            <li key={tester.id} className="py-2.5 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-slate-900 truncate">
                  {tester.fullName || tester.phone || tester.id}
                </p>
                <p className="text-xs text-slate-500">
                  {tester.samples} enregistré(s) · {tester.validated} validé(s)
                </p>
              </div>
              <button className="btn-ghost text-red-600" onClick={() => onRevoke(tester.id)}>
                Révoquer
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
