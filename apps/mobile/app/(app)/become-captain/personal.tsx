import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
  ScrollView, Text, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DateField, ScreenHeader } from '@/components/ui';
import { api } from '@/lib/api';
import { type ApplicationDto } from '@/lib/kyc';
import { Field, PrimaryButton } from '@/lib/form';

export default function PersonalScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fullName, setFullName] = useState('');
  const [nni, setNni] = useState('');
  const [dob, setDob] = useState(''); // YYYY-MM-DD
  const [address, setAddress] = useState('');
  const [emergencyName, setEmergencyName] = useState('');
  const [emergencyPhone, setEmergencyPhone] = useState('');
  const [agencyCode, setAgencyCode] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get<ApplicationDto>('/captain/applications/me');
        if (r.data) {
          setFullName(r.data.fullName ?? '');
          setNni(r.data.nni ?? '');
          setDob(r.data.dateOfBirth ?? '');
          setAddress(r.data.addressLabel ?? '');
          setEmergencyName(r.data.emergencyContactName ?? '');
          setEmergencyPhone(r.data.emergencyContactPhone ?? '');
          setAgencyCode(r.data.agencyCode ?? '');
        }
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const monthLabels = useMemo(
    () => (t('months', { returnObjects: true }) as string[] | string) as string[],
    [t],
  );

  // Captains must be at least 18 years old.
  const today = new Date();
  const maxDob = `${today.getFullYear() - 18}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const minDob = `${today.getFullYear() - 80}-01-01`;

  async function save() {
    if (!/^\d{6,15}$/.test(nni)) {
      Alert.alert(t('becomeCaptain.personal.nniInvalidTitle'), t('becomeCaptain.personal.nniInvalidBody'));
      return;
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
      Alert.alert(t('becomeCaptain.personal.dobInvalidTitle'), t('becomeCaptain.personal.dobInvalidBody'));
      return;
    }
    setSaving(true);
    try {
      await api.patch('/captain/applications/me', {
        fullName: fullName.trim(),
        nni,
        dateOfBirth: dob,
        addressLabel: address.trim(),
        emergencyContactName: emergencyName.trim() || undefined,
        emergencyContactPhone: emergencyPhone.trim(),
        // Empty string clears the code server-side; the API validates the
        // code (unknown agency / window already used → explicit error).
        agencyCode: agencyCode.trim().toUpperCase(),
      });
      router.back();
    } catch (e: any) {
      Alert.alert(t('common.error'), e.response?.data?.error?.message ?? t('becomeCaptain.personal.saveError'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#f8fafc' }}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        style={{ flex: 1 }}
      >
        <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 40 }}>
          <ScreenHeader title={t('becomeCaptain.personal.title')} onBack={() => router.back()} />

          <Field label={t('becomeCaptain.personal.fullName')} value={fullName} onChangeText={setFullName}
            placeholder={t('becomeCaptain.personal.fullNamePlaceholder')} autoCapitalize="words" />
          <Field label={t('becomeCaptain.personal.nni')} value={nni} onChangeText={(v) => setNni(v.replace(/\D/g, ''))}
            placeholder="1234567890" keyboardType="number-pad" maxLength={15}
            helper={t('becomeCaptain.personal.nniHelper')} />
          <DateField
            containerStyle={{ marginTop: 16 }}
            label={t('becomeCaptain.personal.dob')}
            value={dob}
            onChange={setDob}
            placeholder={t('becomeCaptain.personal.dobTapToPick')}
            helper={t('becomeCaptain.personal.dobMinAgeHelper')}
            monthLabels={Array.isArray(monthLabels) ? monthLabels : undefined}
            modalTitle={t('becomeCaptain.personal.dob')}
            cancelLabel={t('common.cancel')}
            confirmLabel={t('common.confirm')}
            minDate={minDob}
            maxDate={maxDob}
          />
          <Field label={t('becomeCaptain.personal.address')} value={address} onChangeText={setAddress}
            placeholder={t('becomeCaptain.personal.addressPlaceholder')} />
          <Field label={t('becomeCaptain.personal.emergencyName')} value={emergencyName} onChangeText={setEmergencyName}
            placeholder={t('becomeCaptain.personal.emergencyNamePlaceholder')} autoCapitalize="words" />
          <Field label={t('becomeCaptain.personal.emergencyPhone')} value={emergencyPhone}
            onChangeText={(v) => setEmergencyPhone(v.replace(/[^\d+]/g, ''))}
            placeholder="+22245XXXXXXX" keyboardType="phone-pad" />
          <Field label={t('becomeCaptain.personal.agencyCode')} value={agencyCode}
            onChangeText={(v) => setAgencyCode(v.toUpperCase())}
            placeholder="AGX-4F7K" autoCapitalize="characters" maxLength={20}
            helper={t('becomeCaptain.personal.agencyCodeHelper')} />

          <PrimaryButton title={t('becomeCaptain.personal.save')} onPress={save} busy={saving} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function pad(n: number) { return n < 10 ? `0${n}` : String(n); }
