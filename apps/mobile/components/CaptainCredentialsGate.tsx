import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator, Alert, Modal, Pressable, ScrollView, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PlainText as Text } from '@/components/ui';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import * as Clipboard from 'expo-clipboard';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

interface Credentials {
  phone: string;
  password: string;
}

// Polls /captain/applications/me/credentials once the local user becomes a
// captain. When the API hands back the one-shot password generated at approval
// time, we cover the screen with a modal that shows phone + password, copy
// buttons for both, and a single "log out" CTA. The user must memorize the
// credentials and re-login on the password screen — that's the whole point.
export default function CaptainCredentialsGate() {
  const router = useRouter();
  const { t } = useTranslation();
  const hydrated = useAuth((s) => s.hydrated);
  const user = useAuth((s) => s.user);
  const clear = useAuth((s) => s.clear);

  const [creds, setCreds] = useState<Credentials | null>(null);
  const [copiedField, setCopiedField] = useState<'phone' | 'password' | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  const role = user?.role;

  const fetchCreds = useCallback(async () => {
    try {
      const r = await api.get<Credentials | null>('/captain/applications/me/credentials');
      if (r.data && r.data.password && r.data.phone) setCreds(r.data);
      else setCreds(null);
    } catch {
      // Silently skip — modal just won't appear; user can still use the app.
    }
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    if (role !== 'captain') {
      setCreds(null);
      return;
    }
    fetchCreds();
  }, [hydrated, role, fetchCreds]);

  async function copy(field: 'phone' | 'password', value: string) {
    await Clipboard.setStringAsync(value);
    setCopiedField(field);
    setTimeout(() => setCopiedField((c) => (c === field ? null : c)), 1800);
  }

  async function doLogout() {
    if (loggingOut) return;
    setLoggingOut(true);
    try {
      // Wipe the server-side plain copy first — once acked it's gone forever.
      await api.post('/captain/applications/me/credentials/ack').catch(() => {});
      await clear();
      router.replace('/(auth)');
    } finally {
      setLoggingOut(false);
    }
  }

  function confirmLogout() {
    Alert.alert(
      t('becomeCaptain.credentials.confirmTitle'),
      t('becomeCaptain.credentials.confirmBody'),
      [
        { text: t('becomeCaptain.credentials.confirmNo'), style: 'cancel' },
        { text: t('becomeCaptain.credentials.confirmYes'), style: 'destructive', onPress: doLogout },
      ],
    );
  }

  if (!creds) return null;

  return (
    <Modal
      visible
      animationType="fade"
      transparent={false}
      // No onRequestClose → Android back button is a no-op. The only escape
      // route is the explicit "log out" button below.
      onRequestClose={() => {}}
    >
      <SafeAreaView style={{ flex: 1, backgroundColor: '#0f172a' }}>
        <ScrollView contentContainerStyle={{ padding: 24, paddingBottom: 32 }}>
          <View style={{
            width: 56, height: 56, borderRadius: 28,
            backgroundColor: '#10a35e', alignItems: 'center', justifyContent: 'center',
            marginTop: 16,
          }}>
            <Text style={{ color: '#fff', fontSize: 28, fontWeight: '700' }}>✓</Text>
          </View>

          <Text style={{
            color: '#fff', fontSize: 26, fontWeight: '700', marginTop: 20,
          }}>
            {t('becomeCaptain.credentials.title')}
          </Text>
          <Text style={{
            color: '#cbd5e1', fontSize: 15, lineHeight: 22, marginTop: 8,
          }}>
            {t('becomeCaptain.credentials.intro')}
          </Text>

          <CredentialCard
            label={t('becomeCaptain.credentials.phoneLabel')}
            value={creds.phone}
            copied={copiedField === 'phone'}
            copyLabel={t('becomeCaptain.credentials.copy')}
            copiedLabel={t('becomeCaptain.credentials.copied')}
            onCopy={() => copy('phone', creds.phone)}
          />
          <CredentialCard
            label={t('becomeCaptain.credentials.passwordLabel')}
            value={creds.password}
            monospace
            copied={copiedField === 'password'}
            copyLabel={t('becomeCaptain.credentials.copy')}
            copiedLabel={t('becomeCaptain.credentials.copied')}
            onCopy={() => copy('password', creds.password)}
          />

          <View style={{
            marginTop: 24, backgroundColor: '#422006', borderRadius: 14,
            padding: 16, borderWidth: 1, borderColor: '#92400e',
          }}>
            <Text style={{ color: '#fde68a', fontSize: 14, lineHeight: 20 }}>
              ⚠️  {t('becomeCaptain.credentials.warning')}
            </Text>
          </View>

          <Pressable
            disabled={loggingOut}
            onPress={confirmLogout}
            style={({ pressed }) => ({
              marginTop: 28,
              backgroundColor: pressed ? '#0f7c4a' : '#10a35e',
              opacity: loggingOut ? 0.6 : 1,
              paddingVertical: 16, borderRadius: 12,
              flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
            })}
          >
            {loggingOut && <ActivityIndicator color="#fff" />}
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>
              {t('becomeCaptain.credentials.logout')}
            </Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
}

function CredentialCard({
  label, value, monospace, copied, copyLabel, copiedLabel, onCopy,
}: {
  label: string;
  value: string;
  monospace?: boolean;
  copied: boolean;
  copyLabel: string;
  copiedLabel: string;
  onCopy: () => void;
}) {
  return (
    <View style={{
      marginTop: 20, backgroundColor: '#1e293b', borderRadius: 14, padding: 16,
      borderWidth: 1, borderColor: '#334155',
    }}>
      <Text style={{
        color: '#94a3b8', fontSize: 12, fontWeight: '600',
        letterSpacing: 0.5, textTransform: 'uppercase',
      }}>
        {label}
      </Text>
      <View style={{
        flexDirection: 'row', alignItems: 'center', marginTop: 8, gap: 12,
      }}>
        <Text
          selectable
          style={{
            flex: 1,
            color: '#fff',
            fontSize: monospace ? 22 : 20,
            fontWeight: '700',
            fontFamily: monospace ? 'Sora_700Bold' : undefined,
            letterSpacing: monospace ? 2 : 0.3,
          }}
        >
          {value}
        </Text>
        <Pressable
          onPress={onCopy}
          style={({ pressed }) => ({
            backgroundColor: copied ? '#166534' : pressed ? '#475569' : '#334155',
            paddingHorizontal: 14, paddingVertical: 10, borderRadius: 10,
          })}
        >
          <Text style={{ color: '#fff', fontSize: 13, fontWeight: '600' }}>
            {copied ? copiedLabel : copyLabel}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
