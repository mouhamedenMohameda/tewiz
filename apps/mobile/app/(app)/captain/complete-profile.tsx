/**
 * Complétion du profil Captain — la seconde moitié de l'onboarding v3.
 *
 * La candidature ne demande que le permis et la carte grise : de quoi décider
 * si la personne peut conduire. Tout le reste est réclamé ICI, après le "oui".
 * Ce n'est pas moins de travail au total — c'est le même travail déplacé de
 * l'autre côté de l'acceptation. Quelqu'un qui vient d'être accepté remplit un
 * formulaire de six champs ; quelqu'un qui espère encore l'être abandonne.
 *
 * Deux verrous distincts, annoncés comme tels :
 *   - véhicule + documents 'online' → bloquent le passage en ligne ;
 *   - documents 'payout'            → bloquent le premier retrait, pas la route.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
  Pressable, RefreshControl, ScrollView, View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  Button, DateField, PlainText as Text, ScreenHeader, SelectField, Sheet,
  wrapRow, type SelectOption,
} from '@/components/ui';
import { Field } from '@/lib/form';
import { DocumentCard, useDocumentUpload, type PendingUpload } from '@/components/DocumentCapture';
import { api } from '@/lib/api';
import {
  type ApplicationDto, type DocumentType, type VehicleType,
  docTypesForStage,
} from '@/lib/kyc';
import { type OnboardingStatus, useOnboarding } from '@/lib/onboarding';
import { VEHICLE_BRANDS, VEHICLE_COLORS } from '@/lib/vehicle-options';
import { apiErrorMessage } from '@/lib/apiError';
import { colors, radius, spacing, statusTone } from '@/theme';

interface ProfileForm {
  fullName: string;
  vehicleType: VehicleType;
  plate: string;
  brand: string;
  model: string;
  year: string;
  color: string;
  seats: string;
}

const EMPTY_PROFILE: ProfileForm = {
  fullName: '', vehicleType: 'car',
  plate: '', brand: '', model: '', year: '', color: '', seats: '4',
};

function profileComplete(f: ProfileForm): boolean {
  return !!(
    f.fullName.trim() && f.plate.trim() && f.brand.trim() &&
    f.model.trim() && f.year && f.color && f.seats
  );
}

export default function CompleteCaptainProfile() {
  const router = useRouter();
  const { t } = useTranslation();

  const { status, reload: reloadStatus } = useOnboarding();
  const [app, setApp] = useState<ApplicationDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState<ProfileForm>(EMPTY_PROFILE);
  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(null);
  const [expiryInput, setExpiryInput] = useState('');

  const load = useCallback(async () => {
    try {
      const [a] = await Promise.all([
        api.get<ApplicationDto | null>('/captain/applications/me'),
        reloadStatus(),
      ]);
      setApp(a.data);
    } catch (e: any) {
      Alert.alert(t('common.error'), apiErrorMessage(e, t, t('becomeCaptain.loadFail')));
    } finally {
      setLoading(false);
    }
  }, [reloadStatus, t]);

  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Le véhicule déjà déclaré alimente le formulaire une seule fois : un
  // rechargement déclenché par l'envoi d'une photo ne doit pas écraser ce que
  // le captain est en train de corriger.
  const [seeded, setSeeded] = useState(false);
  useEffect(() => {
    if (seeded || !status) return;
    const v = status.vehicle;
    const storedColor = (v?.color ?? '').toLowerCase();
    setForm({
      fullName: status.fullName ?? '',
      vehicleType: v?.vehicleType ?? 'car',
      plate: v?.plate ?? '',
      brand: v?.brand ?? '',
      model: v?.model ?? '',
      year: v ? String(v.year) : '',
      color: VEHICLE_COLORS.some((c) => c.key === storedColor) ? storedColor : '',
      seats: v ? String(v.seats) : '4',
    });
    setSeeded(true);
  }, [seeded, status]);

  const { uploadingType, capture, upload } = useDocumentUpload({
    onUploaded: load,
    onNeedExpiry: (p) => { setPendingUpload(p); setExpiryInput(''); },
  });

  function setField<K extends keyof ProfileForm>(k: K, v: ProfileForm[K]) {
    setForm((prev) => ({ ...prev, [k]: v }));
  }

  async function saveProfile() {
    if (!profileComplete(form)) {
      Alert.alert(t('common.error'), t('captainOnboarding.vehicle.incomplete'));
      return;
    }
    setSaving(true);
    try {
      await api.post('/captain/profile', {
        fullName: form.fullName.trim(),
        plate: form.plate.trim().toUpperCase(),
        brand: form.brand.trim(),
        model: form.model.trim(),
        year: Number(form.year),
        color: form.color.trim(),
        seats: Number(form.seats),
        vehicleType: form.vehicleType,
      });
      await reloadStatus();
      Alert.alert(t('common.ok'), t('captainOnboarding.vehicle.saved'));
    } catch (e: any) {
      Alert.alert(t('common.error'), apiErrorMessage(e, t, t('captainOnboarding.vehicle.saveError')));
    } finally {
      setSaving(false);
    }
  }

  async function confirmExpiry() {
    if (!pendingUpload) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiryInput)) {
      Alert.alert(t('becomeCaptain.docs.expiryInvalidTitle'), t('becomeCaptain.docs.expiryInvalidBody'));
      return;
    }
    const { type, uri } = pendingUpload;
    setPendingUpload(null);
    await upload(type, uri, expiryInput);
  }

  const today = new Date();
  const minExpiry = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const maxExpiry = `${today.getFullYear() + 30}-12-31`;
  const monthLabels = useMemo(
    () => (t('months', { returnObjects: true }) as unknown) as string[],
    [t],
  );

  const brandOptions: SelectOption[] = VEHICLE_BRANDS.map((b) => ({ value: b, label: b }));
  const colorOptions: SelectOption[] = VEHICLE_COLORS.map((c) => ({
    value: c.key, label: t(`vehicleColors.${c.key}` as const, c.key), swatch: c.hex,
  }));
  const yearOptions: SelectOption[] = (() => {
    const cy = new Date().getFullYear();
    const arr: SelectOption[] = [];
    for (let y = cy + 1; y >= 1980; y--) arr.push({ value: String(y), label: String(y) });
    return arr;
  })();
  const seatOptions: SelectOption[] = (form.vehicleType === 'moto' ? [1, 2] : [1, 2, 3, 4, 5, 6, 7, 8])
    .map((n) => ({ value: String(n), label: String(n) }));

  if (loading || !status) {
    return (
      <SafeAreaView style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  const onlineDocs = app ? docTypesForStage(app, 'online') : [];
  const payoutDocs = app ? docTypesForStage(app, 'payout') : [];
  const byType = new Map((app?.documents ?? []).map((d) => [d.type, d] as const));
  const gapByType = new Map(
    [...status.onlineGaps, ...status.payoutGaps].map((g) => [g.type, g.reason] as const),
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}
          keyboardShouldPersistTaps="handled"
        >
          <ScreenHeader
            title={t('captainOnboarding.title')}
            subtitle={status.canGoOnline ? t('captainOnboarding.ready') : undefined}
            onBack={() => router.back()}
          />

          {/* ── Identité + véhicule ──────────────────────────────────── */}
          <SectionTitle text={t('captainOnboarding.vehicle.title')} />
          <VehicleStateBadge vehicle={status.vehicle} />
          <Text style={{ fontSize: 13, color: colors.ink2, marginTop: 8, lineHeight: 19 }}>
            {t('captainOnboarding.vehicle.intro')}
          </Text>

          {/* Le nom n'est plus demandé à la candidature : il est sur le permis.
              Un compte venu du parcours invité peut n'en avoir aucun — les
              clients doivent voir quelqu'un. */}
          <Field label={t('becomeCaptain.personal.fullName')} value={form.fullName}
            onChangeText={(v) => setField('fullName', v)}
            placeholder={t('becomeCaptain.personal.fullNamePlaceholder')} autoCapitalize="words" />

          <View style={{ marginTop: 16 }}>
            <Text style={{ fontSize: 13, color: colors.ink2, marginBottom: 8 }}>
              {t('becomeCaptain.vehicle.vehicleTypeLabel')}
            </Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              {(['car', 'moto'] as VehicleType[]).map((type) => {
                const active = form.vehicleType === type;
                return (
                  <Pressable
                    key={type}
                    onPress={() => {
                      setField('vehicleType', type);
                      if (type === 'moto' && Number(form.seats) > 2) setField('seats', '2');
                    }}
                    style={{
                      flex: 1, borderRadius: radius.md, borderWidth: 1,
                      borderColor: active ? colors.ink : colors.lineStrong,
                      backgroundColor: active ? colors.ink : '#fff',
                      paddingVertical: 12, alignItems: 'center',
                    }}
                  >
                    <Text style={{ color: active ? '#fff' : colors.ink, fontWeight: '700' }}>
                      {type === 'car' ? t('becomeCaptain.vehicle.typeCar') : t('becomeCaptain.vehicle.typeMoto')}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          <Field label={t('becomeCaptain.vehicle.plate')} value={form.plate}
            onChangeText={(v) => setField('plate', v)}
            placeholder={t('becomeCaptain.vehicle.platePlaceholder')} autoCapitalize="characters" />

          <SelectField containerStyle={{ marginTop: 16 }} label={t('becomeCaptain.vehicle.brand')}
            value={form.brand} onChange={(v) => setField('brand', v)} options={brandOptions}
            placeholder={t('becomeCaptain.vehicle.brandTapToPick')} modalTitle={t('becomeCaptain.vehicle.brand')}
            searchable searchPlaceholder={t('becomeCaptain.vehicle.brandSearchPlaceholder')} />

          <Field label={t('becomeCaptain.vehicle.model')} value={form.model}
            onChangeText={(v) => setField('model', v)}
            placeholder={t('becomeCaptain.vehicle.modelPlaceholder')} autoCapitalize="words" />

          <SelectField containerStyle={{ marginTop: 16 }} label={t('becomeCaptain.vehicle.year')}
            value={form.year} onChange={(v) => setField('year', v)} options={yearOptions}
            placeholder={t('becomeCaptain.vehicle.yearTapToPick')} modalTitle={t('becomeCaptain.vehicle.year')} />

          <SelectField containerStyle={{ marginTop: 16 }} label={t('becomeCaptain.vehicle.color')}
            value={form.color} onChange={(v) => setField('color', v)} options={colorOptions}
            placeholder={t('becomeCaptain.vehicle.colorTapToPick')} modalTitle={t('becomeCaptain.vehicle.color')} />

          <SelectField containerStyle={{ marginTop: 16 }} label={t('becomeCaptain.vehicle.seats')}
            value={form.seats} onChange={(v) => setField('seats', v)} options={seatOptions}
            placeholder="4" modalTitle={t('becomeCaptain.vehicle.seats')} />

          <Button
            title={t('captainOnboarding.vehicle.save')}
            onPress={saveProfile}
            busy={saving}
            disabled={!profileComplete(form) || saving}
            style={{ marginTop: 20 }}
          />

          {/* ── Documents « pour rouler » ────────────────────────────── */}
          {onlineDocs.length > 0 ? (
            <>
              <SectionTitle text={t('captainOnboarding.docs.title')} />
              <Text style={{ fontSize: 13, color: colors.ink2, lineHeight: 19 }}>
                {t('captainOnboarding.docs.intro')}
              </Text>
              <DocGrid
                types={onlineDocs} byType={byType} gapByType={gapByType}
                uploadingType={uploadingType} onCapture={capture}
              />
            </>
          ) : null}

          {/* ── Documents « pour retirer » ───────────────────────────── */}
          {payoutDocs.length > 0 ? (
            <>
              <SectionTitle text={t('captainOnboarding.docs.payoutTitle')} />
              <Text style={{ fontSize: 13, color: colors.ink2, lineHeight: 19 }}>
                {t('captainOnboarding.docs.payoutIntro')}
              </Text>
              <DocGrid
                types={payoutDocs} byType={byType} gapByType={gapByType}
                uploadingType={uploadingType} onCapture={capture}
              />
            </>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>

      <Sheet
        visible={!!pendingUpload}
        onClose={() => setPendingUpload(null)}
        title={t('becomeCaptain.docs.expiryTitle')}
        subtitle={t('becomeCaptain.docs.expiryHintPicker', {
          label: pendingUpload ? t(`becomeCaptain.documents.${pendingUpload.type}` as const) : '',
        })}
        contentStyle={{ gap: spacing.base }}
      >
        <DateField
          value={expiryInput}
          onChange={setExpiryInput}
          placeholder={t('becomeCaptain.docs.expiryTapToPick')}
          modalTitle={t('becomeCaptain.docs.expiryTitle')}
          cancelLabel={t('common.cancel')}
          confirmLabel={t('common.confirm')}
          minDate={minExpiry}
          maxDate={maxExpiry}
          monthLabels={Array.isArray(monthLabels) ? monthLabels : undefined}
        />
        <View style={{ flexDirection: 'row', gap: spacing.sm }}>
          <Button title={t('common.cancel')} variant="secondary" fullWidth={false}
            onPress={() => setPendingUpload(null)} style={{ flex: 1 }} />
          <Button title={t('common.send')} fullWidth={false}
            onPress={confirmExpiry} style={{ flex: 1 }} />
        </View>
      </Sheet>
    </SafeAreaView>
  );
}

function DocGrid({
  types, byType, gapByType, uploadingType, onCapture,
}: {
  types: DocumentType[];
  byType: Map<DocumentType, any>;
  gapByType: Map<DocumentType, string>;
  uploadingType: DocumentType | null;
  onCapture: (type: DocumentType, source: 'camera' | 'library') => void;
}) {
  const { t } = useTranslation();
  return (
    <View style={{ flexDirection: wrapRow, flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
      {types.map((type) => {
        const reason = gapByType.get(type);
        return (
          <View key={type} style={{ width: '47%' }}>
            <DocumentCard
              type={type}
              doc={byType.get(type)}
              uploading={uploadingType === type}
              editable
              onCapture={(source) => onCapture(type, source)}
            />
            {reason ? (
              <Text style={{ fontSize: 11, color: colors.ink2, marginTop: 4 }}>
                {t(`captainOnboarding.reason.${reason}` as const)}
              </Text>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

function VehicleStateBadge({ vehicle }: { vehicle: OnboardingStatus['vehicle'] }) {
  const { t } = useTranslation();
  const tone = !vehicle ? statusTone.pending
    : vehicle.verifiedAt ? statusTone.done : statusTone.active;
  const label = !vehicle ? t('captainOnboarding.vehicle.missing')
    : vehicle.verifiedAt ? t('captainOnboarding.vehicle.verified')
    : t('captainOnboarding.vehicle.pending');
  return (
    <View style={{
      alignSelf: 'flex-start', backgroundColor: tone.bg,
      borderRadius: radius.sm, paddingHorizontal: 10, paddingVertical: 5, marginTop: 8,
    }}>
      <Text style={{ color: tone.fg, fontSize: 11, fontWeight: '700', letterSpacing: 0.3 }}>
        {label.toUpperCase()}
      </Text>
    </View>
  );
}

function SectionTitle({ text }: { text: string }) {
  return (
    <Text style={{ fontSize: 15, fontWeight: '700', color: colors.ink, marginTop: 28, marginBottom: 4 }}>
      {text}
    </Text>
  );
}

function pad(n: number) { return n < 10 ? `0${n}` : String(n); }
