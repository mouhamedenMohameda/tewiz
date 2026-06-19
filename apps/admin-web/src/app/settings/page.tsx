/**
 * /settings — admin pricing & commission knobs.
 *
 * Edits the single row in `app_settings`. Changes apply only to NEW rides;
 * already-booked rides keep the fare and commission stored on their row.
 */

'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppShell } from '@/components/AppShell';
import { api } from '@/lib/api';

interface PricingSettings {
  baseFareMru: number;
  perKmMru: number;
  minFareMru: number;
  colisBaseFareMru: number;
  colisPerKmMru: number;
  colisMinFareMru: number;
  defaultCommissionBps: number;
  colisCommissionBps: number;
  updatedAt: string;
  updatedBy: string | null;
}

interface FormState {
  baseFareMru: string;
  perKmMru: string;
  minFareMru: string;
  colisBaseFareMru: string;
  colisPerKmMru: string;
  colisMinFareMru: string;
  defaultCommissionPct: string;
  colisCommissionPct: string;
}

const EMPTY_FORM: FormState = {
  baseFareMru: '',
  perKmMru: '',
  minFareMru: '',
  colisBaseFareMru: '',
  colisPerKmMru: '',
  colisMinFareMru: '',
  defaultCommissionPct: '',
  colisCommissionPct: '',
};

function settingsToForm(s: PricingSettings): FormState {
  return {
    baseFareMru: String(s.baseFareMru),
    perKmMru: String(s.perKmMru),
    minFareMru: String(s.minFareMru),
    colisBaseFareMru: String(s.colisBaseFareMru),
    colisPerKmMru: String(s.colisPerKmMru),
    colisMinFareMru: String(s.colisMinFareMru),
    defaultCommissionPct: (s.defaultCommissionBps / 100).toString(),
    colisCommissionPct: (s.colisCommissionBps / 100).toString(),
  };
}

export default function SettingsPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useQuery<PricingSettings>({
    queryKey: ['admin-settings'],
    queryFn: async () => {
      const r = await api.get<PricingSettings>('/admin/settings');
      return r.data;
    },
  });

  useEffect(() => {
    if (query.data) setForm(settingsToForm(query.data));
  }, [query.data]);

  const save = useMutation({
    mutationFn: async () => {
      setError(null);
      const payload = {
        baseFareMru: parseInt(form.baseFareMru, 10),
        perKmMru: parseInt(form.perKmMru, 10),
        minFareMru: parseInt(form.minFareMru, 10),
        colisBaseFareMru: parseInt(form.colisBaseFareMru, 10),
        colisPerKmMru: parseInt(form.colisPerKmMru, 10),
        colisMinFareMru: parseInt(form.colisMinFareMru, 10),
        defaultCommissionBps: Math.round(parseFloat(form.defaultCommissionPct) * 100),
        colisCommissionBps: Math.round(parseFloat(form.colisCommissionPct) * 100),
      };
      const r = await api.put<PricingSettings>('/admin/settings', payload);
      return r.data;
    },
    onSuccess: (data) => {
      setSavedAt(Date.now());
      qc.setQueryData(['admin-settings'], data);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => {
      const msg =
        e.response?.data?.error?.message ??
        e.response?.data?.error?.code ??
        'Erreur lors de l’enregistrement.';
      setError(typeof msg === 'string' ? msg : 'Erreur lors de l’enregistrement.');
    },
  });

  const dirty = !!query.data && JSON.stringify(form) !== JSON.stringify(settingsToForm(query.data));
  const valid = isFormValid(form);

  return (
    <AppShell>
      <div className="p-6 max-w-3xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900 mb-1">Paramètres</h1>
          <p className="text-sm text-slate-500">
            Tarification et commission. Les changements s&apos;appliquent uniquement
            aux nouvelles courses — les courses déjà réservées gardent leur prix.
          </p>
        </div>

        {query.isLoading && <div className="text-slate-500">Chargement...</div>}
        {query.error && (
          <div className="card p-4 bg-red-50 border-red-200">
            <div className="text-sm font-medium text-red-700 mb-1">
              Erreur de chargement
            </div>
            <div className="text-xs text-red-600 font-mono break-all">
              {extractErrorDetail(query.error)}
            </div>
            <div className="text-xs text-slate-600 mt-3">
              Causes habituelles : l&apos;API n&apos;a pas été redéployée (404 sur
              <code className="mx-1">/admin/settings</code>) ou la migration
              <code className="mx-1">0018_app_settings.sql</code> n&apos;a pas été
              appliquée (500 sur la BDD).
            </div>
          </div>
        )}

        {query.data && (
          <>
            <section className="card p-5 mb-4">
              <h2 className="font-semibold text-slate-900 mb-1">Tarification passagers</h2>
              <p className="text-xs text-slate-500 mb-4">
                Formule : <code className="font-mono">prix = max(course minimum, frais de départ + km × prix/km)</code>
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Field
                  label="Prix au kilomètre"
                  suffix="MRU / km"
                  value={form.perKmMru}
                  onChange={(v) => setForm({ ...form, perKmMru: v })}
                />
                <Field
                  label="Frais de départ"
                  suffix="MRU"
                  value={form.baseFareMru}
                  onChange={(v) => setForm({ ...form, baseFareMru: v })}
                />
                <Field
                  label="Course minimum"
                  suffix="MRU"
                  value={form.minFareMru}
                  onChange={(v) => setForm({ ...form, minFareMru: v })}
                />
              </div>
            </section>

            <section className="card p-5 mb-4">
              <h2 className="font-semibold text-slate-900 mb-1">Tarification colis</h2>
              <p className="text-xs text-slate-500 mb-4">
                Même formule, appliquée aux livraisons de colis (généralement moins
                chères qu&apos;une course passager).
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Field
                  label="Prix au kilomètre"
                  suffix="MRU / km"
                  value={form.colisPerKmMru}
                  onChange={(v) => setForm({ ...form, colisPerKmMru: v })}
                />
                <Field
                  label="Frais de départ"
                  suffix="MRU"
                  value={form.colisBaseFareMru}
                  onChange={(v) => setForm({ ...form, colisBaseFareMru: v })}
                />
                <Field
                  label="Course minimum"
                  suffix="MRU"
                  value={form.colisMinFareMru}
                  onChange={(v) => setForm({ ...form, colisMinFareMru: v })}
                />
              </div>
            </section>

            <section className="card p-5 mb-4">
              <h2 className="font-semibold text-slate-900 mb-1">Commission plateforme</h2>
              <p className="text-xs text-slate-500 mb-4">
                Pourcentage débité du portefeuille chauffeur à la fin de chaque
                course (ex. 7 = 7 %).
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field
                  label="Courses passagers"
                  suffix="%"
                  value={form.defaultCommissionPct}
                  onChange={(v) => setForm({ ...form, defaultCommissionPct: v })}
                  step="0.1"
                />
                <Field
                  label="Courses colis"
                  suffix="%"
                  value={form.colisCommissionPct}
                  onChange={(v) => setForm({ ...form, colisCommissionPct: v })}
                  step="0.1"
                />
              </div>
            </section>

            {error && (
              <div className="card p-3 mb-4 text-sm text-red-700 bg-red-50 border-red-200">
                {error}
              </div>
            )}

            <div className="flex items-center justify-between">
              <div className="text-xs text-slate-500">
                Dernière mise à jour : {new Date(query.data.updatedAt).toLocaleString('fr-FR')}
                {savedAt && Date.now() - savedAt < 4000 && (
                  <span className="ml-2 text-emerald-600 font-medium">✓ Enregistré</span>
                )}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => setForm(settingsToForm(query.data!))}
                  disabled={!dirty}
                  className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg disabled:opacity-40"
                >
                  Annuler
                </button>
                <button
                  onClick={() => save.mutate()}
                  disabled={!dirty || !valid || save.isPending}
                  className="px-4 py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg disabled:opacity-50"
                >
                  {save.isPending ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}

function Field({
  label, suffix, value, onChange, step,
}: {
  label: string;
  suffix: string;
  value: string;
  onChange: (v: string) => void;
  step?: string;
}) {
  return (
    <label className="block">
      <span className="block text-xs text-slate-600 mb-1">{label}</span>
      <div className="flex items-stretch border border-slate-300 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-emerald-500/30 focus-within:border-emerald-500">
        <input
          type="number"
          inputMode="decimal"
          min="0"
          step={step ?? '1'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="flex-1 px-3 py-2 text-sm outline-none"
        />
        <span className="px-3 py-2 text-xs text-slate-500 bg-slate-50 border-l border-slate-200 self-stretch flex items-center">
          {suffix}
        </span>
      </div>
    </label>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractErrorDetail(e: any): string {
  const status = e?.response?.status;
  const code = e?.response?.data?.error?.code;
  const msg = e?.response?.data?.error?.message ?? e?.message;
  const parts = [
    status ? `HTTP ${status}` : null,
    code ? `[${code}]` : null,
    msg,
  ].filter(Boolean);
  return parts.join(' ') || 'unknown error';
}

function isFormValid(f: FormState): boolean {
  const ints = [
    f.baseFareMru, f.perKmMru, f.minFareMru,
    f.colisBaseFareMru, f.colisPerKmMru, f.colisMinFareMru,
  ].map((v) => parseInt(v, 10));
  if (ints.some((n) => Number.isNaN(n) || n < 0 || n > 10_000)) return false;
  const pcts = [f.defaultCommissionPct, f.colisCommissionPct].map(parseFloat);
  if (pcts.some((n) => Number.isNaN(n) || n < 0 || n > 50)) return false;
  return true;
}
