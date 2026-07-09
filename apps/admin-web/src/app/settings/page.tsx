/**
 * /settings — admin pricing & commission knobs.
 *
 * Edits the single row in `app_settings`. Changes apply only to NEW rides;
 * already-booked rides keep the fare and commission stored on their row.
 */

'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CAPTAIN_ALERT_SOUND_MODES, type CaptainAlertSoundMode } from '@tewiz/shared-types';
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
  allowOpenRides: boolean;
  openBaseFareMru: number;
  openPerKmMru: number;
  openPerMinuteMru: number;
  openMinFareMru: number;
  nightPricingEnabled: boolean;
  nightPriceMultiplier: number;
  nightPriceStartHour: number;
  nightPriceEndHour: number;
  carpoolingEnabled: boolean;
  carpoolingPublicationFee: number;
  carpoolingBoostFee: number;
  carpoolingCommissionBps: number;
  carpoolingNoShowLimit: number;
  showDemoButtons: boolean;
  demoButtonsAllowedVersions: string;
  captainAlertSoundMode: CaptainAlertSoundMode;
  captainAlertRepeatIntervalS: number;
  captainAlertSoundUrl: string | null;
  privateDriverEnabled: boolean;
  privateDriverHourlyRateMru: number;
  privateDriverMinHours: number;
  privateDriverCommissionBps: number;
  convoyageEnabled: boolean;
  convoyageBaseFareMru: number;
  convoyagePerKmMru: number;
  convoyageMinFareMru: number;
  convoyageCommissionBps: number;
  carRentalEnabled: boolean;
  carRentalDailyRateMru: number;
  carRentalCommissionBps: number;
  roadsideAssistanceEnabled: boolean;
  roadsideAssistanceBaseFareMru: number;
  roadsideAssistanceCommissionBps: number;
  lightMovingEnabled: boolean;
  lightMovingBaseFareMru: number;
  lightMovingPerKmMru: number;
  lightMovingMinFareMru: number;
  lightMovingCommissionBps: number;
  intercityFreightEnabled: boolean;
  intercityFreightBaseFareMru: number;
  intercityFreightPerKmMru: number;
  intercityFreightMinFareMru: number;
  intercityFreightCommissionBps: number;
  equipmentRentalEnabled: boolean;
  equipmentRentalDailyRateMru: number;
  equipmentRentalCommissionBps: number;
  gpsFraudSevereMode: boolean;
  latestAndroidUrl: string | null;
  latestIosUrl: string | null;
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
  allowOpenRides: boolean;
  openBaseFareMru: string;
  openPerKmMru: string;
  openPerMinuteMru: string;
  openMinFareMru: string;
  nightPricingEnabled: boolean;
  nightPriceMultiplier: string;
  nightPriceStartHour: string;
  nightPriceEndHour: string;
  carpoolingEnabled: boolean;
  carpoolingPublicationFee: string;
  carpoolingBoostFee: string;
  carpoolingCommissionPct: string;
  carpoolingNoShowLimit: string;
  showDemoButtons: boolean;
  demoButtonsAllowedVersions: string;
  captainAlertSoundMode: CaptainAlertSoundMode;
  captainAlertRepeatIntervalS: string;
  captainAlertSoundUrl: string;
  privateDriverEnabled: boolean;
  privateDriverHourlyRateMru: string;
  privateDriverMinHours: string;
  privateDriverCommissionPct: string;
  convoyageEnabled: boolean;
  convoyageBaseFareMru: string;
  convoyagePerKmMru: string;
  convoyageMinFareMru: string;
  convoyageCommissionPct: string;
  carRentalEnabled: boolean;
  carRentalDailyRateMru: string;
  carRentalCommissionPct: string;
  roadsideAssistanceEnabled: boolean;
  roadsideAssistanceBaseFareMru: string;
  roadsideAssistanceCommissionPct: string;
  lightMovingEnabled: boolean;
  lightMovingBaseFareMru: string;
  lightMovingPerKmMru: string;
  lightMovingMinFareMru: string;
  lightMovingCommissionPct: string;
  intercityFreightEnabled: boolean;
  intercityFreightBaseFareMru: string;
  intercityFreightPerKmMru: string;
  intercityFreightMinFareMru: string;
  intercityFreightCommissionPct: string;
  equipmentRentalEnabled: boolean;
  equipmentRentalDailyRateMru: string;
  equipmentRentalCommissionPct: string;
  gpsFraudSevereMode: boolean;
  latestAndroidUrl: string;
  latestIosUrl: string;
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
  allowOpenRides: true,
  openBaseFareMru: '',
  openPerKmMru: '',
  openPerMinuteMru: '',
  openMinFareMru: '',
  nightPricingEnabled: true,
  nightPriceMultiplier: '2',
  nightPriceStartHour: '0',
  nightPriceEndHour: '5',
  carpoolingEnabled: true,
  carpoolingPublicationFee: '0',
  carpoolingBoostFee: '200',
  carpoolingCommissionPct: '0',
  carpoolingNoShowLimit: '0',
  privateDriverEnabled: false,
  privateDriverHourlyRateMru: '500',
  privateDriverMinHours: '3',
  privateDriverCommissionPct: '10',
  convoyageEnabled: false,
  convoyageBaseFareMru: '200',
  convoyagePerKmMru: '60',
  convoyageMinFareMru: '500',
  convoyageCommissionPct: '15',
  carRentalEnabled: false,
  carRentalDailyRateMru: '5000',
  carRentalCommissionPct: '10',
  roadsideAssistanceEnabled: false,
  roadsideAssistanceBaseFareMru: '1000',
  roadsideAssistanceCommissionPct: '10',
  lightMovingEnabled: false,
  lightMovingBaseFareMru: '300',
  lightMovingPerKmMru: '80',
  lightMovingMinFareMru: '600',
  lightMovingCommissionPct: '10',
  intercityFreightEnabled: false,
  intercityFreightBaseFareMru: '500',
  intercityFreightPerKmMru: '100',
  intercityFreightMinFareMru: '1000',
  intercityFreightCommissionPct: '10',
  equipmentRentalEnabled: false,
  equipmentRentalDailyRateMru: '3000',
  equipmentRentalCommissionPct: '10',
  showDemoButtons: false,
  demoButtonsAllowedVersions: '1.1.12',
  captainAlertSoundMode: 'standard',
  captainAlertRepeatIntervalS: '2',
  captainAlertSoundUrl: '',
  gpsFraudSevereMode: false,
  latestAndroidUrl: '',
  latestIosUrl: '',
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
    allowOpenRides: s.allowOpenRides,
    openBaseFareMru: String(s.openBaseFareMru),
    openPerKmMru: String(s.openPerKmMru),
    openPerMinuteMru: String(s.openPerMinuteMru),
    openMinFareMru: String(s.openMinFareMru),
    nightPricingEnabled: s.nightPricingEnabled,
    nightPriceMultiplier: String(s.nightPriceMultiplier),
    nightPriceStartHour: String(s.nightPriceStartHour),
    nightPriceEndHour: String(s.nightPriceEndHour),
    carpoolingEnabled: s.carpoolingEnabled,
    carpoolingPublicationFee: String(s.carpoolingPublicationFee),
    carpoolingBoostFee: String(s.carpoolingBoostFee),
    carpoolingCommissionPct: (s.carpoolingCommissionBps / 100).toString(),
    carpoolingNoShowLimit: String(s.carpoolingNoShowLimit),
    privateDriverEnabled: s.privateDriverEnabled,
    privateDriverHourlyRateMru: String(s.privateDriverHourlyRateMru),
    privateDriverMinHours: String(s.privateDriverMinHours),
    privateDriverCommissionPct: (s.privateDriverCommissionBps / 100).toString(),
    convoyageEnabled: s.convoyageEnabled,
    convoyageBaseFareMru: String(s.convoyageBaseFareMru),
    convoyagePerKmMru: String(s.convoyagePerKmMru),
    convoyageMinFareMru: String(s.convoyageMinFareMru),
    convoyageCommissionPct: (s.convoyageCommissionBps / 100).toString(),
    carRentalEnabled: s.carRentalEnabled,
    carRentalDailyRateMru: String(s.carRentalDailyRateMru),
    carRentalCommissionPct: (s.carRentalCommissionBps / 100).toString(),
    roadsideAssistanceEnabled: s.roadsideAssistanceEnabled,
    roadsideAssistanceBaseFareMru: String(s.roadsideAssistanceBaseFareMru),
    roadsideAssistanceCommissionPct: (s.roadsideAssistanceCommissionBps / 100).toString(),
    lightMovingEnabled: s.lightMovingEnabled,
    lightMovingBaseFareMru: String(s.lightMovingBaseFareMru),
    lightMovingPerKmMru: String(s.lightMovingPerKmMru),
    lightMovingMinFareMru: String(s.lightMovingMinFareMru),
    lightMovingCommissionPct: (s.lightMovingCommissionBps / 100).toString(),
    intercityFreightEnabled: s.intercityFreightEnabled,
    intercityFreightBaseFareMru: String(s.intercityFreightBaseFareMru),
    intercityFreightPerKmMru: String(s.intercityFreightPerKmMru),
    intercityFreightMinFareMru: String(s.intercityFreightMinFareMru),
    intercityFreightCommissionPct: (s.intercityFreightCommissionBps / 100).toString(),
    equipmentRentalEnabled: s.equipmentRentalEnabled,
    equipmentRentalDailyRateMru: String(s.equipmentRentalDailyRateMru),
    equipmentRentalCommissionPct: (s.equipmentRentalCommissionBps / 100).toString(),
    showDemoButtons: s.showDemoButtons,
    demoButtonsAllowedVersions: s.demoButtonsAllowedVersions,
    captainAlertSoundMode: s.captainAlertSoundMode,
    captainAlertRepeatIntervalS: String(s.captainAlertRepeatIntervalS),
    captainAlertSoundUrl: s.captainAlertSoundUrl ?? '',
    gpsFraudSevereMode: s.gpsFraudSevereMode,
    latestAndroidUrl: s.latestAndroidUrl ?? '',
    latestIosUrl: s.latestIosUrl ?? '',
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
        allowOpenRides: form.allowOpenRides,
        openBaseFareMru: parseInt(form.openBaseFareMru, 10),
        openPerKmMru: parseInt(form.openPerKmMru, 10),
        openPerMinuteMru: parseInt(form.openPerMinuteMru, 10),
        openMinFareMru: parseInt(form.openMinFareMru, 10),
        nightPricingEnabled: form.nightPricingEnabled,
        nightPriceMultiplier: parseFloat(form.nightPriceMultiplier),
        nightPriceStartHour: parseInt(form.nightPriceStartHour, 10),
        nightPriceEndHour: parseInt(form.nightPriceEndHour, 10),
        carpoolingEnabled: form.carpoolingEnabled,
        carpoolingPublicationFee: parseInt(form.carpoolingPublicationFee, 10),
        carpoolingBoostFee: parseInt(form.carpoolingBoostFee, 10),
        carpoolingCommissionBps: Math.round(parseFloat(form.carpoolingCommissionPct) * 100),
        carpoolingNoShowLimit: parseInt(form.carpoolingNoShowLimit, 10),
        privateDriverEnabled: form.privateDriverEnabled,
        privateDriverHourlyRateMru: parseInt(form.privateDriverHourlyRateMru, 10),
        privateDriverMinHours: parseInt(form.privateDriverMinHours, 10),
        privateDriverCommissionBps: Math.round(parseFloat(form.privateDriverCommissionPct) * 100),
        convoyageEnabled: form.convoyageEnabled,
        convoyageBaseFareMru: parseInt(form.convoyageBaseFareMru, 10),
        convoyagePerKmMru: parseInt(form.convoyagePerKmMru, 10),
        convoyageMinFareMru: parseInt(form.convoyageMinFareMru, 10),
        convoyageCommissionBps: Math.round(parseFloat(form.convoyageCommissionPct) * 100),
        carRentalEnabled: form.carRentalEnabled,
        carRentalDailyRateMru: parseInt(form.carRentalDailyRateMru, 10),
        carRentalCommissionBps: Math.round(parseFloat(form.carRentalCommissionPct) * 100),
        roadsideAssistanceEnabled: form.roadsideAssistanceEnabled,
        roadsideAssistanceBaseFareMru: parseInt(form.roadsideAssistanceBaseFareMru, 10),
        roadsideAssistanceCommissionBps: Math.round(parseFloat(form.roadsideAssistanceCommissionPct) * 100),
        lightMovingEnabled: form.lightMovingEnabled,
        lightMovingBaseFareMru: parseInt(form.lightMovingBaseFareMru, 10),
        lightMovingPerKmMru: parseInt(form.lightMovingPerKmMru, 10),
        lightMovingMinFareMru: parseInt(form.lightMovingMinFareMru, 10),
        lightMovingCommissionBps: Math.round(parseFloat(form.lightMovingCommissionPct) * 100),
        intercityFreightEnabled: form.intercityFreightEnabled,
        intercityFreightBaseFareMru: parseInt(form.intercityFreightBaseFareMru, 10),
        intercityFreightPerKmMru: parseInt(form.intercityFreightPerKmMru, 10),
        intercityFreightMinFareMru: parseInt(form.intercityFreightMinFareMru, 10),
        intercityFreightCommissionBps: Math.round(parseFloat(form.intercityFreightCommissionPct) * 100),
        equipmentRentalEnabled: form.equipmentRentalEnabled,
        equipmentRentalDailyRateMru: parseInt(form.equipmentRentalDailyRateMru, 10),
        equipmentRentalCommissionBps: Math.round(parseFloat(form.equipmentRentalCommissionPct) * 100),
        showDemoButtons: form.showDemoButtons,
        demoButtonsAllowedVersions: form.demoButtonsAllowedVersions.trim(),
        captainAlertSoundMode: form.captainAlertSoundMode,
        captainAlertRepeatIntervalS: parseInt(form.captainAlertRepeatIntervalS, 10),
        captainAlertSoundUrl: form.captainAlertSoundUrl.trim() === ''
          ? null
          : form.captainAlertSoundUrl.trim(),
        gpsFraudSevereMode: form.gpsFraudSevereMode,
        latestAndroidUrl: form.latestAndroidUrl.trim() === ''
          ? null
          : form.latestAndroidUrl.trim(),
        latestIosUrl: form.latestIosUrl.trim() === ''
          ? null
          : form.latestIosUrl.trim(),
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
                <h2 className="font-semibold text-slate-900">Course ouverte (compteur)</h2>
                <label className="flex items-center gap-2 text-sm select-none cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.allowOpenRides}
                    onChange={(e) => setForm({ ...form, allowOpenRides: e.target.checked })}
                    className="w-4 h-4 accent-emerald-600"
                  />
                  <span className={form.allowOpenRides ? 'text-emerald-700 font-medium' : 'text-slate-500'}>
                    {form.allowOpenRides ? 'Activée' : 'Désactivée'}
                  </span>
                </label>
              </div>
              <p className="text-xs text-slate-500 mb-4">
                Course sans destination fixée à l&apos;avance. Le tarif est calculé au
                compteur côté serveur (à partir du GPS du chauffeur) :{' '}
                <code className="font-mono">fare = max(min, départ + km × prix/km + min × prix/min)</code>.
                Seul le chauffeur peut terminer la course.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <Field
                  label="Frais de départ"
                  suffix="MRU"
                  value={form.openBaseFareMru}
                  onChange={(v) => setForm({ ...form, openBaseFareMru: v })}
                />
                <Field
                  label="Prix au kilomètre"
                  suffix="MRU / km"
                  value={form.openPerKmMru}
                  onChange={(v) => setForm({ ...form, openPerKmMru: v })}
                />
                <Field
                  label="Prix à la minute"
                  suffix="MRU / min"
                  value={form.openPerMinuteMru}
                  onChange={(v) => setForm({ ...form, openPerMinuteMru: v })}
                />
                <Field
                  label="Course minimum"
                  suffix="MRU"
                  value={form.openMinFareMru}
                  onChange={(v) => setForm({ ...form, openMinFareMru: v })}
                />
              </div>
            </section>

            <section className="card p-5 mb-4 border border-blue-200 bg-blue-50/30">
              <div className="flex items-start justify-between mb-1">
                <h2 className="font-semibold text-slate-900">Chauffeur Privé</h2>
                <label className="flex items-center gap-2 text-sm select-none cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.privateDriverEnabled}
                    onChange={(e) => setForm({ ...form, privateDriverEnabled: e.target.checked })}
                    className="w-4 h-4 accent-blue-600"
                  />
                  <span className={form.privateDriverEnabled ? 'text-blue-700 font-medium' : 'text-slate-500'}>
                    {form.privateDriverEnabled ? 'Activé' : 'Désactivé'}
                  </span>
                </label>
              </div>
              <p className="text-xs text-slate-500 mb-4">
                Réservation d&apos;un chauffeur à l&apos;heure (3h, 6h, 12h, 24h).
                Tarif forfaitaire sans destination fixe.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Field
                  label="Tarif horaire"
                  suffix="MRU/h"
                  value={form.privateDriverHourlyRateMru}
                  onChange={(v) => setForm({ ...form, privateDriverHourlyRateMru: v })}
                  step="10"
                />
                <Field
                  label="Durée minimum"
                  suffix="h"
                  value={form.privateDriverMinHours}
                  onChange={(v) => setForm({ ...form, privateDriverMinHours: v })}
                  step="1"
                />
                <Field
                  label="Commission"
                  suffix="%"
                  value={form.privateDriverCommissionPct}
                  onChange={(v) => setForm({ ...form, privateDriverCommissionPct: v })}
                  step="0.5"
                />
              </div>
            </section>

            <section className="card p-5 mb-4 border border-purple-200 bg-purple-50/30">
              <div className="flex items-start justify-between mb-1">
                <h2 className="font-semibold text-slate-900">Convoyage</h2>
                <label className="flex items-center gap-2 text-sm select-none cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.convoyageEnabled}
                    onChange={(e) => setForm({ ...form, convoyageEnabled: e.target.checked })}
                    className="w-4 h-4 accent-purple-600"
                  />
                  <span className={form.convoyageEnabled ? 'text-purple-700 font-medium' : 'text-slate-500'}>
                    {form.convoyageEnabled ? 'Activé' : 'Désactivé'}
                  </span>
                </label>
              </div>
              <p className="text-xs text-slate-500 mb-4">
                Un chauffeur conduit le véhicule du client de A vers B.
                Tarification distance (base + km × prix/km, minimum garanti).
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field
                  label="Frais de départ"
                  suffix="MRU"
                  value={form.convoyageBaseFareMru}
                  onChange={(v) => setForm({ ...form, convoyageBaseFareMru: v })}
                />
                <Field
                  label="Prix / km"
                  suffix="MRU"
                  value={form.convoyagePerKmMru}
                  onChange={(v) => setForm({ ...form, convoyagePerKmMru: v })}
                />
                <Field
                  label="Course minimum"
                  suffix="MRU"
                  value={form.convoyageMinFareMru}
                  onChange={(v) => setForm({ ...form, convoyageMinFareMru: v })}
                />
                <Field
                  label="Commission"
                  suffix="%"
                  value={form.convoyageCommissionPct}
                  onChange={(v) => setForm({ ...form, convoyageCommissionPct: v })}
                  step="0.5"
                />
              </div>
            </section>

            <section className="card p-5 mb-4 border border-amber-200 bg-amber-50/30">
              <div className="flex items-start justify-between mb-1">
                <h2 className="font-semibold text-slate-900">Location Auto</h2>
                <label className="flex items-center gap-2 text-sm select-none cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.carRentalEnabled}
                    onChange={(e) => setForm({ ...form, carRentalEnabled: e.target.checked })}
                    className="w-4 h-4 accent-amber-600"
                  />
                  <span className={form.carRentalEnabled ? 'text-amber-700 font-medium' : 'text-slate-500'}>
                    {form.carRentalEnabled ? 'Activé' : 'Désactivé'}
                  </span>
                </label>
              </div>
              <p className="text-xs text-slate-500 mb-4">Location de voiture à la journée.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field
                  label="Tarif journalier"
                  suffix="MRU"
                  value={form.carRentalDailyRateMru}
                  onChange={(v) => setForm({ ...form, carRentalDailyRateMru: v })}
                />
                <Field
                  label="Commission"
                  suffix="%"
                  value={form.carRentalCommissionPct}
                  onChange={(v) => setForm({ ...form, carRentalCommissionPct: v })}
                  step="0.5"
                />
              </div>
            </section>

            <section className="card p-5 mb-4 border border-red-200 bg-red-50/30">
              <div className="flex items-start justify-between mb-1">
                <h2 className="font-semibold text-slate-900">Assistance Routière</h2>
                <label className="flex items-center gap-2 text-sm select-none cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.roadsideAssistanceEnabled}
                    onChange={(e) => setForm({ ...form, roadsideAssistanceEnabled: e.target.checked })}
                    className="w-4 h-4 accent-red-600"
                  />
                  <span className={form.roadsideAssistanceEnabled ? 'text-red-700 font-medium' : 'text-slate-500'}>
                    {form.roadsideAssistanceEnabled ? 'Activé' : 'Désactivé'}
                  </span>
                </label>
              </div>
              <p className="text-xs text-slate-500 mb-4">Assistance routière (dépannage, remorquage).</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field
                  label="Frais de base"
                  suffix="MRU"
                  value={form.roadsideAssistanceBaseFareMru}
                  onChange={(v) => setForm({ ...form, roadsideAssistanceBaseFareMru: v })}
                />
                <Field
                  label="Commission"
                  suffix="%"
                  value={form.roadsideAssistanceCommissionPct}
                  onChange={(v) => setForm({ ...form, roadsideAssistanceCommissionPct: v })}
                  step="0.5"
                />
              </div>
            </section>

            <section className="card p-5 mb-4 border border-sky-200 bg-sky-50/30">
              <div className="flex items-start justify-between mb-1">
                <h2 className="font-semibold text-slate-900">Déménagement Léger</h2>
                <label className="flex items-center gap-2 text-sm select-none cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.lightMovingEnabled}
                    onChange={(e) => setForm({ ...form, lightMovingEnabled: e.target.checked })}
                    className="w-4 h-4 accent-sky-600"
                  />
                  <span className={form.lightMovingEnabled ? 'text-sky-700 font-medium' : 'text-slate-500'}>
                    {form.lightMovingEnabled ? 'Activé' : 'Désactivé'}
                  </span>
                </label>
              </div>
              <p className="text-xs text-slate-500 mb-4">
                Transport d&apos;objets / petit déménagement. Tarification distance.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field
                  label="Frais de départ"
                  suffix="MRU"
                  value={form.lightMovingBaseFareMru}
                  onChange={(v) => setForm({ ...form, lightMovingBaseFareMru: v })}
                />
                <Field
                  label="Prix / km"
                  suffix="MRU"
                  value={form.lightMovingPerKmMru}
                  onChange={(v) => setForm({ ...form, lightMovingPerKmMru: v })}
                />
                <Field
                  label="Course minimum"
                  suffix="MRU"
                  value={form.lightMovingMinFareMru}
                  onChange={(v) => setForm({ ...form, lightMovingMinFareMru: v })}
                />
                <Field
                  label="Commission"
                  suffix="%"
                  value={form.lightMovingCommissionPct}
                  onChange={(v) => setForm({ ...form, lightMovingCommissionPct: v })}
                  step="0.5"
                />
              </div>
            </section>

            <section className="card p-5 mb-4 border border-violet-200 bg-violet-50/30">
              <div className="flex items-start justify-between mb-1">
                <h2 className="font-semibold text-slate-900">Fret Intercité</h2>
                <label className="flex items-center gap-2 text-sm select-none cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.intercityFreightEnabled}
                    onChange={(e) => setForm({ ...form, intercityFreightEnabled: e.target.checked })}
                    className="w-4 h-4 accent-violet-600"
                  />
                  <span className={form.intercityFreightEnabled ? 'text-violet-700 font-medium' : 'text-slate-500'}>
                    {form.intercityFreightEnabled ? 'Activé' : 'Désactivé'}
                  </span>
                </label>
              </div>
              <p className="text-xs text-slate-500 mb-4">
                Envoi de marchandises entre villes. Tarification distance.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field
                  label="Frais de départ"
                  suffix="MRU"
                  value={form.intercityFreightBaseFareMru}
                  onChange={(v) => setForm({ ...form, intercityFreightBaseFareMru: v })}
                />
                <Field
                  label="Prix / km"
                  suffix="MRU"
                  value={form.intercityFreightPerKmMru}
                  onChange={(v) => setForm({ ...form, intercityFreightPerKmMru: v })}
                />
                <Field
                  label="Course minimum"
                  suffix="MRU"
                  value={form.intercityFreightMinFareMru}
                  onChange={(v) => setForm({ ...form, intercityFreightMinFareMru: v })}
                />
                <Field
                  label="Commission"
                  suffix="%"
                  value={form.intercityFreightCommissionPct}
                  onChange={(v) => setForm({ ...form, intercityFreightCommissionPct: v })}
                  step="0.5"
                />
              </div>
            </section>

            <section className="card p-5 mb-4 border border-indigo-200 bg-indigo-50/30">
              <div className="flex items-start justify-between mb-1">
                <h2 className="font-semibold text-slate-900">Location Équipement</h2>
                <label className="flex items-center gap-2 text-sm select-none cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.equipmentRentalEnabled}
                    onChange={(e) => setForm({ ...form, equipmentRentalEnabled: e.target.checked })}
                    className="w-4 h-4 accent-indigo-600"
                  />
                  <span className={form.equipmentRentalEnabled ? 'text-indigo-700 font-medium' : 'text-slate-500'}>
                    {form.equipmentRentalEnabled ? 'Activé' : 'Désactivé'}
                  </span>
                </label>
              </div>
              <p className="text-xs text-slate-500 mb-4">Location d&apos;équipement à la journée.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Field
                  label="Tarif journalier"
                  suffix="MRU"
                  value={form.equipmentRentalDailyRateMru}
                  onChange={(v) => setForm({ ...form, equipmentRentalDailyRateMru: v })}
                />
                <Field
                  label="Commission"
                  suffix="%"
                  value={form.equipmentRentalCommissionPct}
                  onChange={(v) => setForm({ ...form, equipmentRentalCommissionPct: v })}
                  step="0.5"
                />
              </div>
            </section>

            <section className="card p-5 mb-4">
              <div className="flex items-start justify-between mb-1">
                <h2 className="font-semibold text-slate-900">Majoration de nuit</h2>
                <label className="flex items-center gap-2 text-sm select-none cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.nightPricingEnabled}
                    onChange={(e) => setForm({ ...form, nightPricingEnabled: e.target.checked })}
                    className="w-4 h-4 accent-indigo-600"
                  />
                  <span className={form.nightPricingEnabled ? 'text-indigo-700 font-medium' : 'text-slate-500'}>
                    {form.nightPricingEnabled ? 'Activée' : 'Désactivée'}
                  </span>
                </label>
              </div>
              <p className="text-xs text-slate-500 mb-4">
                Applique un multiplicateur sur les prix entre l&apos;heure de début (incluse)
                et l&apos;heure de fin (exclue), selon l&apos;heure locale du serveur.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Field
                  label="Multiplicateur"
                  suffix="x"
                  value={form.nightPriceMultiplier}
                  onChange={(v) => setForm({ ...form, nightPriceMultiplier: v })}
                  step="0.1"
                />
                <Field
                  label="Début"
                  suffix="h"
                  value={form.nightPriceStartHour}
                  onChange={(v) => setForm({ ...form, nightPriceStartHour: v })}
                  step="1"
                />
                <Field
                  label="Fin"
                  suffix="h"
                  value={form.nightPriceEndHour}
                  onChange={(v) => setForm({ ...form, nightPriceEndHour: v })}
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

            <section className="card p-5 mb-4 border border-emerald-200 bg-emerald-50/30">
              <div className="flex items-start justify-between mb-1">
                <h2 className="font-semibold text-slate-900">Covoiturage inter-villes</h2>
                <label className="flex items-center gap-2 text-sm select-none cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.carpoolingEnabled}
                    onChange={(e) => setForm({ ...form, carpoolingEnabled: e.target.checked })}
                    className="w-4 h-4 accent-emerald-600"
                  />
                  <span className={form.carpoolingEnabled ? 'text-emerald-700 font-medium' : 'text-slate-500'}>
                    {form.carpoolingEnabled ? 'Active' : 'Desactive'}
                  </span>
                </label>
              </div>
              <p className="text-xs text-slate-500 mb-4">
                Publication de trajets inter-villes. La publication est gratuite : le
                conducteur ne paie qu&apos;une commission au succes, prelevee de son wallet
                uniquement quand un trajet est confirme (code OTP). Laissez la commission
                a 0 % pendant le lancement. Le boost 24h reste optionnel et payant.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Field
                  label="Commission au succes"
                  suffix="%"
                  value={form.carpoolingCommissionPct}
                  onChange={(v) => setForm({ ...form, carpoolingCommissionPct: v })}
                />
                <Field
                  label="Frais de publication"
                  suffix="MRU"
                  value={form.carpoolingPublicationFee}
                  onChange={(v) => setForm({ ...form, carpoolingPublicationFee: v })}
                />
                <Field
                  label="Frais boost (24h)"
                  suffix="MRU"
                  value={form.carpoolingBoostFee}
                  onChange={(v) => setForm({ ...form, carpoolingBoostFee: v })}
                />
                <Field
                  label="Limite absences (30j, 0 = off)"
                  suffix="abs."
                  value={form.carpoolingNoShowLimit}
                  onChange={(v) => setForm({ ...form, carpoolingNoShowLimit: v })}
                />
              </div>
            </section>

            <section className="card p-5 mb-4 border-2 border-dashed border-amber-300 bg-amber-50">
              <h2 className="font-semibold text-slate-900 mb-1">Alerte nouvelle course</h2>
              <p className="text-xs text-slate-600 mb-4">
                Reglez l&apos;intensite de la sonnerie cote chauffeur. Le mode critique
                rend l&apos;alerte iPhone plus agressive; la repetition controle tous les
                combien de secondes l&apos;app relance l&apos;alerte tant que la course n&apos;est pas vue.
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <label className="block">
                  <span className="block text-xs text-slate-600 mb-1">Mode sonore</span>
                  <select
                    value={form.captainAlertSoundMode}
                    onChange={(e) => setForm({
                      ...form,
                      captainAlertSoundMode: e.target.value as CaptainAlertSoundMode,
                    })}
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                  >
                    {CAPTAIN_ALERT_SOUND_MODES.map((mode) => (
                      <option key={mode} value={mode}>
                        {mode === 'critical' ? 'Critique (plus agressif)' : 'Standard'}
                      </option>
                    ))}
                  </select>
                </label>
                <Field
                  label="Rappel toutes les"
                  suffix="sec"
                  value={form.captainAlertRepeatIntervalS}
                  onChange={(v) => setForm({ ...form, captainAlertRepeatIntervalS: v })}
                  step="1"
                />
              </div>

              <label className="block mt-4">
                <span className="block text-xs text-slate-600 mb-1">
                  URL sonnerie personnalisee (optionnel)
                </span>
                <input
                  type="url"
                  inputMode="url"
                  placeholder="https://.../new-ride-alert.mp3"
                  value={form.captainAlertSoundUrl}
                  onChange={(e) => setForm({ ...form, captainAlertSoundUrl: e.target.value })}
                  className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg bg-white"
                />
                <p className="text-[11px] text-slate-500 mt-1">
                  Utilisee par l&apos;app chauffeur quand elle est ouverte (alerte modale).
                  Si vide ou inaccessible, l&apos;app retombe automatiquement sur la sonnerie par defaut.
                </p>
              </label>
            </section>

            <section className="card p-5 mb-4 border-2 border-dashed border-red-300 bg-red-50">
              <div className="flex items-start justify-between mb-1">
                <h2 className="font-semibold text-slate-900">Politique GPS severe</h2>
                <label className="flex items-center gap-2 text-sm select-none cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.gpsFraudSevereMode}
                    onChange={(e) => setForm({ ...form, gpsFraudSevereMode: e.target.checked })}
                    className="w-4 h-4 accent-red-600"
                  />
                  <span className={form.gpsFraudSevereMode ? 'text-red-700 font-medium' : 'text-slate-500'}>
                    {form.gpsFraudSevereMode ? 'Active' : 'Desactivee'}
                  </span>
                </label>
              </div>
              <p className="text-xs text-slate-600">
                Mode strict de sanction GPS. Desactive par defaut au lancement.
                Activez-le uniquement quand vous etes pret a appliquer les avertissements/penalites.
              </p>
            </section>

            <section className="card p-5 mb-4 border-2 border-dashed border-amber-300 bg-amber-50">
              <div className="flex items-start justify-between mb-1">
                <h2 className="font-semibold text-slate-900">Boutons démo (App Store / Google Play)</h2>
                <label className="flex items-center gap-2 text-sm select-none cursor-pointer">
                  <input
                    type="checkbox"
                    checked={form.showDemoButtons}
                    onChange={(e) => setForm({ ...form, showDemoButtons: e.target.checked })}
                    className="w-4 h-4 accent-amber-500"
                  />
                  <span className={form.showDemoButtons ? 'text-amber-700 font-medium' : 'text-slate-500'}>
                    {form.showDemoButtons ? '✓ Visible (mode review)' : 'Masqué'}
                  </span>
                </label>
              </div>
              <p className="text-xs text-slate-600 mb-3">
                Affiche des boutons de connexion en un tap sur l&apos;écran d&apos;accueil de l&apos;app
                (comptes démo passager + capitaine). À activer avant une soumission App Store / Google Play,
                à désactiver après approbation.
              </p>
              <label className="block text-sm text-slate-700 mb-1">
                Version(s) autorisée(s)
              </label>
              <input
                type="text"
                value={form.demoButtonsAllowedVersions}
                onChange={(e) => setForm({ ...form, demoButtonsAllowedVersions: e.target.value })}
                placeholder="1.1.12"
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
              <p className="text-xs text-slate-500 mt-1">
                Les boutons n&apos;apparaissent que sur ces versions d&apos;app (celle soumise pour review),
                séparées par des virgules (ex. <code>1.1.12</code> ou <code>1.1.12,1.1.13</code>). Les versions
                déjà livrées ne les verront jamais, même toggle activé.
              </p>
            </section>

            <section className="card p-5 mb-4">
              <h2 className="font-semibold text-slate-900 mb-1">
                Liens de téléchargement de l&apos;application
              </h2>
              <p className="text-xs text-slate-600 mb-3">
                Affichés en bas de l&apos;écran Paramètres de l&apos;app mobile
                (boutons « Dernière version Android » et « Dernière version iOS »).
                Laissez un champ vide pour masquer le bouton correspondant.
              </p>
              <label className="block mb-3">
                <span className="block text-xs text-slate-600 mb-1">
                  Lien Android (APK / Google Play)
                </span>
                <input
                  type="url"
                  inputMode="url"
                  placeholder="https://play.google.com/store/apps/details?id=..."
                  value={form.latestAndroidUrl}
                  onChange={(e) => setForm({ ...form, latestAndroidUrl: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="block">
                <span className="block text-xs text-slate-600 mb-1">
                  Lien iOS (App Store / TestFlight)
                </span>
                <input
                  type="url"
                  inputMode="url"
                  placeholder="https://apps.apple.com/app/id..."
                  value={form.latestIosUrl}
                  onChange={(e) => setForm({ ...form, latestIosUrl: e.target.value })}
                  className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                />
              </label>
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
  // Open ride tariff: base / per-km / minimum capped like the classic
  // passenger tariff; per-minute is small (0..1000) by design.
  const openInts = [
    parseInt(f.openBaseFareMru, 10),
    parseInt(f.openPerKmMru, 10),
    parseInt(f.openMinFareMru, 10),
  ];
  if (openInts.some((n) => Number.isNaN(n) || n < 0 || n > 10_000)) return false;
  const openPerMin = parseInt(f.openPerMinuteMru, 10);
  if (Number.isNaN(openPerMin) || openPerMin < 0 || openPerMin > 1_000) return false;
  const nightMultiplier = parseFloat(f.nightPriceMultiplier);
  if (Number.isNaN(nightMultiplier) || nightMultiplier < 1 || nightMultiplier > 10) return false;
  const nightStart = parseInt(f.nightPriceStartHour, 10);
  const nightEnd = parseInt(f.nightPriceEndHour, 10);
  if (Number.isNaN(nightStart) || Number.isNaN(nightEnd)) return false;
  if (nightStart < 0 || nightStart > 23 || nightEnd < 0 || nightEnd > 23) return false;
  if (nightStart === nightEnd) return false;
  const alertRepeat = parseInt(f.captainAlertRepeatIntervalS, 10);
  if (Number.isNaN(alertRepeat) || alertRepeat < 1 || alertRepeat > 15) return false;
  const carpoolFees = [
    parseInt(f.carpoolingPublicationFee, 10),
    parseInt(f.carpoolingBoostFee, 10),
  ];
  if (carpoolFees.some((n) => Number.isNaN(n) || n < 0 || n > 10_000)) return false;
  const pdRate = parseInt(f.privateDriverHourlyRateMru, 10);
  if (Number.isNaN(pdRate) || pdRate < 0 || pdRate > 50_000) return false;
  const pdMinH = parseInt(f.privateDriverMinHours, 10);
  if (Number.isNaN(pdMinH) || pdMinH < 1 || pdMinH > 24) return false;
  const pdComm = parseFloat(f.privateDriverCommissionPct);
  if (Number.isNaN(pdComm) || pdComm < 0 || pdComm > 50) return false;
  const cvInts = [
    parseInt(f.convoyageBaseFareMru, 10),
    parseInt(f.convoyagePerKmMru, 10),
    parseInt(f.convoyageMinFareMru, 10),
  ];
  if (cvInts.some((n) => Number.isNaN(n) || n < 0 || n > 10_000)) return false;
  const cvComm = parseFloat(f.convoyageCommissionPct);
  if (Number.isNaN(cvComm) || cvComm < 0 || cvComm > 50) return false;
  const urls = [
    f.captainAlertSoundUrl.trim(),
    f.latestAndroidUrl.trim(),
    f.latestIosUrl.trim(),
  ];
  for (const url of urls) {
    if (!url) continue;
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
    } catch {
      return false;
    }
  }
  return true;
}
