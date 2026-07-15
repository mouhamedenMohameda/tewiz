import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Modal, Platform,
  Pressable, RefreshControl, ScrollView, Text, View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { DateField, ScreenHeader, SelectField, type SelectOption } from '@/components/ui';
import { Field } from '@/lib/form';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  type AppDoc, type ApplicationDto, type ApplicationStatus, type DocumentType,
  type VehicleType,
  DOCUMENTS_WITH_EXPIRY, DOCUMENT_ORDER, docsComplete, isDocRequired, requiredDocTypes,
} from '@/lib/kyc';
import { VEHICLE_BRANDS, VEHICLE_COLORS } from '@/lib/vehicle-options';
import { APP_NAME } from '@/lib/brand';

interface FormState {
  fullName: string;
  whatsapp: string;
  vehicleType: VehicleType;
  plate: string;
  brand: string;
  model: string;
  year: string;
  color: string;
  seats: string;
}

const EMPTY_FORM: FormState = {
  fullName: '', whatsapp: '', vehicleType: 'car',
  plate: '', brand: '', model: '', year: '', color: '', seats: '4',
};

function formComplete(f: FormState): boolean {
  return !!(
    f.fullName.trim() && f.vehicleType && f.plate.trim() &&
    f.brand.trim() && f.model.trim() && f.year && f.color && f.seats
  );
}

export default function BecomeCaptainHome() {
  const router = useRouter();
  const { t } = useTranslation();
  const user = useAuth((s) => s.user);
  const setUser = useAuth((s) => s.setUser);
  const setActiveMode = useAuth((s) => s.setActiveMode);

  const [app, setApp] = useState<ApplicationDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  // Seed the form from the loaded application only once (keyed by id) so the
  // periodic refresh triggered by a photo upload doesn't wipe what the captain
  // is typing.
  const seededRef = useRef<string | null>(null);

  // Photo upload state.
  const [uploadingType, setUploadingType] = useState<DocumentType | null>(null);
  const [pendingUpload, setPendingUpload] = useState<{ type: DocumentType; uri: string } | null>(null);
  const [expiryInput, setExpiryInput] = useState('');

  const load = useCallback(async () => {
    try {
      const r = await api.get<ApplicationDto | null>('/captain/applications/me');
      setApp(r.data);
    } catch (e: any) {
      Alert.alert(t('common.error'), e.response?.data?.error?.message ?? t('becomeCaptain.loadFail'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    if (!app || seededRef.current === app.id) return;
    seededRef.current = app.id;
    const storedColor = (app.vehicleColor ?? '').toLowerCase();
    setForm({
      fullName: app.fullName ?? user?.fullName ?? '',
      whatsapp: app.whatsapp ?? '',
      vehicleType: app.vehicleType ?? 'car',
      plate: app.vehiclePlate ?? '',
      brand: app.vehicleBrand ?? '',
      model: app.vehicleModel ?? '',
      year: app.vehicleYear ? String(app.vehicleYear) : '',
      color: VEHICLE_COLORS.some((c) => c.key === storedColor) ? storedColor : '',
      seats: app.vehicleSeats ? String(app.vehicleSeats) : '4',
    });
  }, [app, user]);

  useEffect(() => {
    if (app?.status !== 'approved') return;
    // Approved → sync the cached user to captain and switch into captain mode.
    (async () => {
      if (user && user.role !== 'captain') await setUser({ ...user, role: 'captain' });
      await setActiveMode('captain');
      router.replace('/(app)/captain');
    })();
  }, [app?.status, router, setUser, setActiveMode, user]);

  function setField<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((prev) => ({ ...prev, [k]: v }));
  }

  async function startApplication() {
    setCreating(true);
    try {
      const r = await api.post<ApplicationDto>('/captain/applications');
      setApp(r.data);
    } catch (e: any) {
      Alert.alert(t('common.error'), e.response?.data?.error?.message ?? t('becomeCaptain.createFail'));
    } finally {
      setCreating(false);
    }
  }

  // ── Photo upload ──────────────────────────────────────────────────────────
  const editable = !!app && (app.status === 'draft' || app.status === 'needs_correction');
  const byType = new Map<DocumentType, AppDoc>();
  for (const d of app?.documents ?? []) byType.set(d.type, d);

  const today = new Date();
  const minExpiry = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const maxExpiry = `${today.getFullYear() + 30}-12-31`;
  const monthLabels = useMemo(
    () => (t('months', { returnObjects: true }) as unknown) as string[],
    [t],
  );

  async function pickAndUpload(type: DocumentType, source: 'camera' | 'library') {
    if (!editable) return;
    const perm = source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (perm.status !== 'granted') {
      Alert.alert(t('common.permissionRequired'), t('common.permissionRequiredBody'));
      return;
    }
    const r = source === 'camera'
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7 });
    if (r.canceled || !r.assets[0]) return;
    const uri = r.assets[0].uri;
    if (DOCUMENTS_WITH_EXPIRY.includes(type)) {
      setPendingUpload({ type, uri });
      setExpiryInput('');
      return;
    }
    await doUpload(type, uri, null);
  }

  async function confirmExpiry() {
    if (!pendingUpload) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(expiryInput)) {
      Alert.alert(t('becomeCaptain.docs.expiryInvalidTitle'), t('becomeCaptain.docs.expiryInvalidBody'));
      return;
    }
    const { type, uri } = pendingUpload;
    setPendingUpload(null);
    await doUpload(type, uri, expiryInput);
  }

  async function doUpload(type: DocumentType, uri: string, expiresAt: string | null) {
    setUploadingType(type);
    try {
      const fd = new FormData();
      fd.append('file', { uri, name: `${type}.jpg`, type: 'image/jpeg' } as any);
      fd.append('type', type);
      if (expiresAt) fd.append('expiresAt', expiresAt);
      await api.post('/captain/applications/me/documents', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      await load();
    } catch (e: any) {
      Alert.alert(t('common.error'), e.response?.data?.error?.message ?? t('becomeCaptain.docs.uploadFail'));
    } finally {
      setUploadingType(null);
    }
  }

  function openPicker(type: DocumentType) {
    Alert.alert(docLabel(type), t('becomeCaptain.docs.sourceTitle'), [
      { text: t('becomeCaptain.docs.sourceCamera'), onPress: () => pickAndUpload(type, 'camera') },
      { text: t('becomeCaptain.docs.sourceGallery'), onPress: () => pickAndUpload(type, 'library') },
      { text: t('common.cancel'), style: 'cancel' },
    ]);
  }

  async function deleteDoc(doc: AppDoc) {
    if (!editable) return;
    Alert.alert(t('becomeCaptain.docs.deleteTitle'), docLabel(doc.type), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('common.delete'), style: 'destructive',
        onPress: async () => {
          try { await api.delete(`/captain/applications/me/documents/${doc.id}`); await load(); }
          catch (e: any) { Alert.alert(t('common.error'), e.response?.data?.error?.message ?? t('errors.generic')); }
        },
      },
    ]);
  }

  const docLabel = (type: DocumentType) => t(`becomeCaptain.documents.${type}` as const);

  // ── Submit ────────────────────────────────────────────────────────────────
  async function submitApplication() {
    if (!app) return;
    const yearNum = Number(form.year);
    const seatsNum = Number(form.seats);
    const currentYear = new Date().getFullYear();
    if (!formComplete(form)) {
      Alert.alert(t('becomeCaptain.incompleteTitle'), t('becomeCaptain.completeAllSteps'));
      return;
    }
    if (!yearNum || yearNum < 1980 || yearNum > currentYear + 1) {
      Alert.alert(t('becomeCaptain.vehicle.yearInvalidTitle'), t('becomeCaptain.vehicle.yearInvalidBody', { max: currentYear + 1 }));
      return;
    }
    const wa = form.whatsapp.trim();
    if (wa && !/^\+?\d{8,15}$/.test(wa)) {
      Alert.alert(t('becomeCaptain.contact.invalidTitle'), t('becomeCaptain.contact.invalidBody'));
      return;
    }
    setSubmitting(true);
    try {
      // Persist the fields, then submit. WhatsApp is optional: send it only when
      // filled — otherwise the server falls back to the login phone.
      await api.patch('/captain/applications/me', {
        fullName: form.fullName.trim(),
        vehicleType: form.vehicleType,
        vehiclePlate: form.plate.trim().toUpperCase(),
        vehicleBrand: form.brand.trim(),
        vehicleModel: form.model.trim(),
        vehicleYear: yearNum,
        vehicleColor: form.color.trim(),
        vehicleSeats: seatsNum,
        ...(wa ? { whatsapp: wa } : {}),
      });
      const r = await api.post<ApplicationDto>('/captain/applications/me/submit');
      setApp(r.data);
      Alert.alert(t('becomeCaptain.submittedTitle'), t('becomeCaptain.submittedBody'));
    } catch (e: any) {
      const data = e.response?.data?.error;
      const missing = data?.details?.missing as string[] | undefined;
      Alert.alert(
        t('becomeCaptain.incompleteTitle'),
        missing?.length
          ? t('becomeCaptain.missingPrefix', { items: missing.join('\n• ') })
          : (data?.message ?? t('becomeCaptain.completeAllSteps')),
      );
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  const requiredDocs = app
    ? DOCUMENT_ORDER.filter((type) => isDocRequired(app, type))
    : [];
  const allComplete = !!app && formComplete(form) && docsComplete(app);

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

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f8fafc' }}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}
          keyboardShouldPersistTaps="handled"
        >
          <ScreenHeader
            title={t('becomeCaptain.title', { app: APP_NAME })}
            subtitle={user?.phone ?? undefined}
            onBack={() => router.back()}
          />

          {!app ? (
            <NoApplication onStart={startApplication} busy={creating} />
          ) : (
            <View style={{ marginTop: 16 }}>
              <StatusBanner status={app.status} />

              {app.status === 'needs_correction' && app.correctionNotes ? (
                <CorrectionCard title={t('becomeCaptain.correctionNotesTitle')} body={app.correctionNotes} />
              ) : null}
              {app.status === 'rejected' && app.rejectReason ? (
                <ErrorCard title={t('becomeCaptain.rejectReason')} body={app.rejectReason} />
              ) : null}

              {editable ? (
                <>
                  {/* Identité + véhicule (le strict nécessaire) */}
                  <SectionTitle text={t('becomeCaptain.vehicle.title')} />
                  <Field label={t('becomeCaptain.personal.fullName')} value={form.fullName}
                    onChangeText={(v) => setField('fullName', v)}
                    placeholder={t('becomeCaptain.personal.fullNamePlaceholder')} autoCapitalize="words" />

                  <View style={{ marginTop: 16 }}>
                    <Text style={{ fontSize: 13, color: '#475569', marginBottom: 8 }}>
                      {t('becomeCaptain.vehicle.vehicleTypeLabel')}
                    </Text>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      {(['car', 'moto'] as VehicleType[]).map((type) => {
                        const active = form.vehicleType === type;
                        return (
                          <Pressable key={type} onPress={() => {
                            setField('vehicleType', type);
                            if (type === 'moto' && Number(form.seats) > 2) setField('seats', '2');
                          }}
                            style={{
                              flex: 1, borderRadius: 12, borderWidth: 1,
                              borderColor: active ? '#0f172a' : '#cbd5e1',
                              backgroundColor: active ? '#0f172a' : '#fff',
                              paddingVertical: 12, alignItems: 'center',
                            }}>
                            <Text style={{ color: active ? '#fff' : '#0f172a', fontWeight: '700' }}>
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

                  {/* WhatsApp (facultatif) */}
                  <Field label={t('becomeCaptain.contact.whatsapp')} value={form.whatsapp}
                    onChangeText={(v) => setField('whatsapp', v.replace(/[^\d+]/g, ''))}
                    placeholder="+22245XXXXXXX" keyboardType="phone-pad"
                    helper={t('becomeCaptain.stepContactSub')} />

                  {/* Documents */}
                  <SectionTitle text={t('becomeCaptain.docs.title')} />
                  <Text style={{ fontSize: 13, color: '#64748b', marginBottom: 4 }}>
                    {t('becomeCaptain.docs.introV2')}
                  </Text>
                  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginTop: 12 }}>
                    {requiredDocs.map((type) => (
                      <DocCard
                        key={type}
                        doc={byType.get(type)}
                        uploading={uploadingType === type}
                        editable={editable}
                        label={docLabel(type)}
                        onPick={() => openPicker(type)}
                        onDelete={() => { const d = byType.get(type); if (d) deleteDoc(d); }}
                      />
                    ))}
                  </View>

                  <Pressable
                    disabled={!allComplete || submitting}
                    onPress={submitApplication}
                    style={({ pressed }) => ({
                      marginTop: 24,
                      backgroundColor: pressed ? '#0f7c4a' : '#10a35e',
                      opacity: !allComplete || submitting ? 0.5 : 1,
                      paddingVertical: 16, borderRadius: 12,
                      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                    })}
                  >
                    {submitting && <ActivityIndicator color="#fff" />}
                    <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>
                      {allComplete ? t('becomeCaptain.submit') : t('becomeCaptain.completeFirst')}
                    </Text>
                  </Pressable>
                </>
              ) : null}
            </View>
          )}
        </ScrollView>
      </KeyboardAvoidingView>

      {/* Expiry-date modal (assurance / vignette / visite technique) */}
      <Modal visible={!!pendingUpload} transparent animationType="fade" onRequestClose={() => setPendingUpload(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(15,23,42,0.5)', justifyContent: 'center', padding: 24 }}>
          <View style={{ backgroundColor: '#fff', borderRadius: 14, padding: 20 }}>
            <Text style={{ fontSize: 17, fontWeight: '700', color: '#0f172a' }}>
              {t('becomeCaptain.docs.expiryTitle')}
            </Text>
            <Text style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
              {t('becomeCaptain.docs.expiryHintPicker', { label: pendingUpload ? docLabel(pendingUpload.type) : '' })}
            </Text>
            <DateField
              containerStyle={{ marginTop: 12 }}
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
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
              <Pressable onPress={() => setPendingUpload(null)}
                style={({ pressed }) => ({ flex: 1, padding: 12, borderRadius: 10, backgroundColor: pressed ? '#e2e8f0' : '#f1f5f9', alignItems: 'center' })}>
                <Text style={{ color: '#0f172a', fontWeight: '600' }}>{t('common.cancel')}</Text>
              </Pressable>
              <Pressable onPress={confirmExpiry}
                style={({ pressed }) => ({ flex: 1, padding: 12, borderRadius: 10, backgroundColor: pressed ? '#0f7c4a' : '#10a35e', alignItems: 'center' })}>
                <Text style={{ color: '#fff', fontWeight: '600' }}>{t('common.send')}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function SectionTitle({ text }: { text: string }) {
  return (
    <Text style={{ fontSize: 16, fontWeight: '700', color: '#0f172a', marginTop: 24, marginBottom: 4 }}>
      {text}
    </Text>
  );
}

function NoApplication({ onStart, busy }: { onStart: () => void; busy: boolean }) {
  const { t } = useTranslation();
  return (
    <View style={{ marginTop: 16 }}>
      <Text style={{ fontSize: 15, color: '#475569', lineHeight: 22 }}>
        {t('becomeCaptain.intro', { app: APP_NAME })}
      </Text>
      <Pressable
        disabled={busy}
        onPress={onStart}
        style={({ pressed }) => ({
          marginTop: 24, backgroundColor: pressed ? '#0f7c4a' : '#10a35e',
          opacity: busy ? 0.5 : 1, paddingVertical: 16, borderRadius: 12,
          flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
        })}
      >
        {busy && <ActivityIndicator color="#fff" />}
        <Text style={{ color: '#fff', fontSize: 16, fontWeight: '600' }}>{t('becomeCaptain.start')}</Text>
      </Pressable>
    </View>
  );
}

function DocCard({
  doc, uploading, editable, label, onPick, onDelete,
}: {
  doc?: AppDoc; uploading: boolean; editable: boolean; label: string;
  onPick: () => void; onDelete: () => void;
}) {
  const { t } = useTranslation();
  const status = doc?.status;
  const borderColor =
    status === 'approved' ? '#bbf7d0' : status === 'rejected' ? '#fecaca' :
    status === 'pending' ? '#fde68a' : '#e2e8f0';
  const bg =
    status === 'approved' ? '#f0fdf4' : status === 'rejected' ? '#fef2f2' :
    status === 'pending' ? '#fefce8' : '#fff';

  return (
    <Pressable
      onPress={editable ? onPick : undefined}
      onLongPress={doc && editable ? onDelete : undefined}
      style={({ pressed }) => ({
        width: '47%', backgroundColor: pressed ? '#f1f5f9' : bg,
        borderColor, borderWidth: 1, borderRadius: 12, padding: 12, minHeight: 110,
      })}
    >
      <Text style={{ fontSize: 13, fontWeight: '600', color: '#0f172a' }} numberOfLines={2}>{label}</Text>
      <View style={{ flex: 1 }} />
      {uploading ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <ActivityIndicator size="small" />
          <Text style={{ fontSize: 12, color: '#64748b' }}>{t('common.sending')}</Text>
        </View>
      ) : doc ? (
        <View>
          <Text style={{
            fontSize: 11, fontWeight: '700',
            color: status === 'approved' ? '#15803d' : status === 'rejected' ? '#b91c1c' : '#92400e',
          }}>
            {status === 'approved' ? `✓ ${t('becomeCaptain.docs.statusApproved')}` :
              status === 'rejected' ? `✕ ${t('becomeCaptain.docs.statusRejected')}` :
              status === 'expired' ? t('becomeCaptain.docs.statusExpired') :
              `⏳ ${t('becomeCaptain.docs.statusPending')}`}
          </Text>
          {doc.expiresAt ? (
            <Text style={{ fontSize: 10, color: '#64748b', marginTop: 2 }}>
              {t('becomeCaptain.docs.expiresPrefix', { date: doc.expiresAt.slice(0, 10) })}
            </Text>
          ) : null}
          {doc.rejectReason ? (
            <Text style={{ fontSize: 10, color: '#b91c1c', marginTop: 2 }} numberOfLines={2}>{doc.rejectReason}</Text>
          ) : null}
          {editable ? (
            <Text style={{ fontSize: 10, color: '#64748b', marginTop: 4 }}>{t('becomeCaptain.docs.replaceHint')}</Text>
          ) : null}
        </View>
      ) : (
        <Text style={{ fontSize: 12, color: '#64748b' }}>
          {editable ? t('becomeCaptain.docs.tapToAdd') : t('common.notSent')}
        </Text>
      )}
    </Pressable>
  );
}

function ErrorCard({ title, body }: { title: string; body: string }) {
  return (
    <View style={{ marginTop: 16, backgroundColor: '#fef2f2', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#fecaca' }}>
      <Text style={{ fontSize: 14, fontWeight: '600', color: '#b91c1c' }}>{title}</Text>
      <Text style={{ fontSize: 13, color: '#7f1d1d', marginTop: 6 }}>{body}</Text>
    </View>
  );
}

function CorrectionCard({ title, body }: { title: string; body: string }) {
  return (
    <View style={{ marginTop: 16, backgroundColor: '#fffbeb', borderRadius: 14, padding: 16, borderWidth: 1, borderColor: '#fde68a' }}>
      <Text style={{ fontSize: 14, fontWeight: '700', color: '#92400e' }}>{title}</Text>
      <Text style={{ fontSize: 14, color: '#78350f', marginTop: 8, lineHeight: 20 }}>{body}</Text>
    </View>
  );
}

function StatusBanner({ status }: { status: ApplicationStatus }) {
  const { t } = useTranslation();
  const palette: Record<ApplicationStatus, { bg: string; fg: string }> = {
    draft:            { bg: '#fef9c3', fg: '#854d0e' },
    submitted:        { bg: '#dbeafe', fg: '#1e40af' },
    under_review:     { bg: '#e0e7ff', fg: '#3730a3' },
    needs_correction: { bg: '#fef3c7', fg: '#92400e' },
    approved:         { bg: '#dcfce7', fg: '#166534' },
    rejected:         { bg: '#fee2e2', fg: '#991b1b' },
  };
  const s = palette[status];
  return (
    <View style={{ backgroundColor: s.bg, borderRadius: 14, padding: 16 }}>
      <Text style={{ color: s.fg, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 }}>
        {t(`becomeCaptain.banner.${status}.label` as const).toUpperCase()}
      </Text>
      <Text style={{ color: s.fg, fontSize: 14, marginTop: 4, lineHeight: 20 }}>
        {t(`becomeCaptain.banner.${status}.desc` as const, { app: APP_NAME })}
      </Text>
    </View>
  );
}

function pad(n: number) { return n < 10 ? `0${n}` : String(n); }
