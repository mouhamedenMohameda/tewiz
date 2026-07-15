import { useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, KeyboardAvoidingView, Platform,
  ScrollView, Text, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/ui';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { type ApplicationDto } from '@/lib/kyc';
import { Field, PrimaryButton } from '@/lib/form';

export default function ContactScreen() {
  const router = useRouter();
  const { t } = useTranslation();
  const user = useAuth((s) => s.user);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [whatsapp, setWhatsapp] = useState('');

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get<ApplicationDto>('/captain/applications/me');
        // Prefill with the number already on the application, otherwise the
        // account's login phone — in Mauritania it is, in practice, the same
        // WhatsApp number. The captain can still change it.
        setWhatsapp(r.data?.whatsapp ?? user?.phone ?? '');
      } finally {
        setLoading(false);
      }
    })();
  }, [user?.phone]);

  async function save() {
    const trimmed = whatsapp.trim();
    // WhatsApp is optional. An empty field just means "use my login phone"
    // (the server falls back to it at submit), so we leave without saving.
    if (trimmed === '') {
      router.back();
      return;
    }
    if (!/^\+?\d{8,15}$/.test(trimmed)) {
      Alert.alert(
        t('becomeCaptain.contact.invalidTitle'),
        t('becomeCaptain.contact.invalidBody'),
      );
      return;
    }
    setSaving(true);
    try {
      await api.patch('/captain/applications/me', { whatsapp: trimmed });
      router.back();
    } catch (e: any) {
      Alert.alert(t('common.error'), e.response?.data?.error?.message ?? t('becomeCaptain.contact.saveError'));
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
          <ScreenHeader title={t('becomeCaptain.contact.title')} onBack={() => router.back()} />

          <Text style={{ fontSize: 13, color: '#64748b', marginTop: 4, lineHeight: 20 }}>
            {t('becomeCaptain.contact.intro')}
          </Text>

          <Field
            label={t('becomeCaptain.contact.whatsapp')}
            value={whatsapp}
            onChangeText={(v) => setWhatsapp(v.replace(/[^\d+]/g, ''))}
            placeholder="+22245XXXXXXX"
            keyboardType="phone-pad"
            helper={t('becomeCaptain.contact.whatsappHelper')}
          />

          <PrimaryButton title={t('becomeCaptain.contact.save')} onPress={save} busy={saving} />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
