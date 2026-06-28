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
  longDistanceThresholdM: number;
  operatorPassengerCommissionBps: number;
  operatorColisCommissionBps: number;
  searchingTimeoutS: number;
  commissionBonusEnabled: boolean;
  commissionBonusThresholdMru: number;
  commissionBonusWindowDays: number;
  commissionBonusRewardDays: number;
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
  operatorPassengerCommissionPct: string;
  operatorColisCommissionPct: string;
  longDistanceThresholdKm: string;
  searchingTimeoutMin: string;
  commissionBonusEnabled: boolean;
  commissionBonusThresholdMru: string;
  commissionBonusWindowDays: string;
  commissionBonusRewardDays: string;
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
  operatorPassengerCommissionPct: '',
  operatorColisCommissionPct: '',
  longDistanceThresholdKm: '',
  searchingTimeoutMin: '',
  commissionBonusEnabled: false,
  commissionBonusThresholdMru: '',
  commissionBonusWindowDays: '',
  commissionBonusRewardDays: '',
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
    operatorPassengerCommissionPct: (s.operatorPassengerCommissionBps / 100).toString(),
    operatorColisCommissionPct: (s.operatorColisCommissionBps / 100).toString(),
    longDistanceThresholdKm: (s.longDistanceThresholdM / 1000).toString(),
    searchingTimeoutMin: (s.searchingTimeoutS / 60).toString(),
    commissionBonusEnabled: s.commissionBonusEnabled,
    commissionBonusThresholdMru: String(s.commissionBonusThresholdMru),
    commissionBonusWindowDays: String(s.commissionBonusWindowDays),
    commissionBonusRewardDays: String(s.commissionBonusRewardDays),
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
        operatorPassengerCommissionBps: Math.round(parseFloat(form.operatorPassengerCommissionPct) * 100),
        operatorColisCommissionBps: Math.round(parseFloat(form.operatorColisCommissionPct) * 100),
        longDistanceThresholdM: Math.round(parseFloat(form.longDistanceThresholdKm) * 1000),
        searchingTimeoutS: Math.round(parseFloat(form.searchingTimeoutMin) * 60),
        commissionBonusEnabled: form.commissionBonusEnabled,
        commissionBonusThresholdMru: parseInt(form.commissionBonusThresholdMru, 10),
        commissionBonusWindowDays: parseInt(form.commissionBonusWindowDays, 10),
        commissionBonusRewardDays: parseInt(form.commissionBonusRewardDays, 10),
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
                course auto-réservée depuis l&apos;app (ex. 7 = 7 %).
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

            <section className="card p-5 mb-4">
              <h2 className="font-semibold text-slate-900 mb-1">Commission call-center</h2>
              <p className="text-xs text-slate-500 mb-4">
                Pourcentage appliqué aux courses créées par un opérateur (passager
                ayant appelé). Permet de couvrir le temps du call-center.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field
                  label="Passagers (call-center)"
                  suffix="%"
                  value={form.operatorPassengerCommissionPct}
                  onChange={(v) => setForm({ ...form, operatorPassengerCommissionPct: v })}
                  step="0.1"
                />
                <Field
                  label="Colis (call-center)"
                  suffix="%"
                  value={form.operatorColisCommissionPct}
                  onChange={(v) => setForm({ ...form, operatorColisCommissionPct: v })}
                  step="0.1"
                />
              </div>
            </section>

            <section className="card p-5 mb-4">
              <h2 className="font-semibold text-slate-900 mb-1">Courses inter-villes</h2>
              <p className="text-xs text-slate-500 mb-4">
                Au-dessus de ce seuil, une course est considérée longue distance.
                Elle n&apos;est proposée qu&apos;aux chauffeurs ayant activé
                « J&apos;accepte les courses inter-villes » dans leurs préférences.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field
                  label="Seuil longue distance"
                  suffix="km"
                  value={form.longDistanceThresholdKm}
                  onChange={(v) => setForm({ ...form, longDistanceThresholdKm: v })}
                  step="1"
                />
              </div>
            </section>

            <section className="card p-5 mb-4">
              <div className="flex items-start justify-between mb-1">
                <h2 className="font-semibold text-slate-900">Bonus chauffeur</h2>
                <label className="flex items-center gap-2 text-sm select-none cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.commissionBonusEnabled}
                    onChange={(e) => setForm({ ...form, commissionBonusEnabled: e.target.checked })}
                    className="w-4 h-4 accent-emerald-600"
                  />
                  <span className={form.commissionBonusEnabled ? 'text-emerald-700 font-medium' : 'text-slate-500'}>
                    {form.commissionBonusEnabled ? 'Activé' : 'Désactivé'}
                  </span>
                </label>
              </div>
              <p className="text-xs text-slate-500 mb-4">
                Quand un chauffeur paie <strong>{form.commissionBonusThresholdMru || 'X'} MRU</strong> de
                commission en <strong>{form.commissionBonusWindowDays || 'Y'} jours</strong>, sa commission
                est divisée par 2 pendant <strong>{form.commissionBonusRewardDays || 'Z'} jours</strong>,
                sur toutes les courses (in-app, colis, call-center). Tout changement déclenche
                automatiquement une notification à tous les chauffeurs.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Field
                  label="Seuil"
                  suffix="MRU"
                  value={form.commissionBonusThresholdMru}
                  onChange={(v) => setForm({ ...form, commissionBonusThresholdMru: v })}
                  step="10"
                />
                <Field
                  label="Fenêtre"
                  suffix="jours"
                  value={form.commissionBonusWindowDays}
                  onChange={(v) => setForm({ ...form, commissionBonusWindowDays: v })}
                  step="1"
                />
                <Field
                  label="Durée du bonus"
                  suffix="jours"
                  value={form.commissionBonusRewardDays}
                  onChange={(v) => setForm({ ...form, commissionBonusRewardDays: v })}
                  step="1"
                />
              </div>
            </section>

            <section className="card p-5 mb-4">
              <h2 className="font-semibold text-slate-900 mb-1">Expiration des courses</h2>
              <p className="text-xs text-slate-500 mb-4">
                Une course qui reste en « Recherche » plus longtemps que ce délai
                est automatiquement annulée par le système. Mettez 0 pour désactiver
                cette fonctionnalité.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field
                  label="Délai avant annulation"
                  suffix="min"
                  value={form.searchingTimeoutMin}
                  onChange={(v) => setForm({ ...form, searchingTimeoutMin: v })}
                  step="1"
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
  const pcts = [
    f.defaultCommissionPct, f.colisCommissionPct,
    f.operatorPassengerCommissionPct, f.operatorColisCommissionPct,
  ].map(parseFloat);
  if (pcts.some((n) => Number.isNaN(n) || n < 0 || n > 50)) return false;
  const km = parseFloat(f.longDistanceThresholdKm);
  if (Number.isNaN(km) || km < 1 || km > 1000) return false;
  const timeoutMin = parseFloat(f.searchingTimeoutMin);
  // 0 disables the feature, otherwise between 1 and 60 minutes.
  if (Number.isNaN(timeoutMin) || timeoutMin < 0 || timeoutMin > 60) return false;
  if (timeoutMin > 0 && timeoutMin < 1) return false;
  const bonusInts = [
    parseInt(f.commissionBonusThresholdMru, 10),
    parseInt(f.commissionBonusWindowDays, 10),
    parseInt(f.commissionBonusRewardDays, 10),
  ];
  if (bonusInts.some((n) => Number.isNaN(n) || n < 1)) return false;
  if (bonusInts[0]! > 1_000_000) return false;
  if (bonusInts[1]! > 365 || bonusInts[2]! > 365) return false;
  return true;
}
