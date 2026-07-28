/**
 * CaptainTermsGate — full-screen consent gate for captains who were already
 * approved before the terms existed (or before the current version).
 *
 * Mounted at the captain layout root, so it covers every captain screen. The
 * only ways out are accepting or logging out; the Android back button is a
 * no-op, same as CaptainCredentialsGate.
 *
 * Fail-open on purpose: if the status call fails (offline, older API) the gate
 * stays hidden rather than bricking the app. The consent is still enforced
 * server-side wherever it legally matters.
 */

import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { TermsSheet } from '@/components/TermsSheet';
import { useAuth } from '@/lib/auth';
import { acceptTerms, fetchTermsStatus } from '@/lib/terms';

export default function CaptainTermsGate() {
  const router = useRouter();
  const { t } = useTranslation();
  const hydrated = useAuth((s) => s.hydrated);
  const role = useAuth((s) => s.user?.role);
  const clear = useAuth((s) => s.clear);

  const [needsAccept, setNeedsAccept] = useState(false);
  const [busy, setBusy] = useState(false);

  const check = useCallback(async () => {
    if (!hydrated || role !== 'captain') {
      setNeedsAccept(false);
      return;
    }
    try {
      const status = await fetchTermsStatus();
      setNeedsAccept(!status.accepted);
    } catch {
      setNeedsAccept(false);
    }
  }, [hydrated, role]);

  useEffect(() => { check(); }, [check]);

  async function onAccept() {
    setBusy(true);
    try {
      await acceptTerms();
      setNeedsAccept(false);
    } catch (e: any) {
      Alert.alert(
        t('common.error'),
        e.response?.status === 409
          ? t('terms.updateRequired')
          : e.response?.data?.error?.message ?? t('terms.acceptFail'),
      );
    } finally {
      setBusy(false);
    }
  }

  function onLogout() {
    Alert.alert(t('terms.gate.title'), t('terms.gate.intro'), [
      { text: t('common.cancel'), style: 'cancel' },
      {
        text: t('terms.gate.logout'),
        style: 'destructive',
        onPress: async () => { await clear(); router.replace('/(auth)'); },
      },
    ]);
  }

  if (!needsAccept) return null;

  return (
    <TermsSheet
      visible
      busy={busy}
      dismissible={false}
      notice={t('terms.gate.intro')}
      onAccept={onAccept}
      secondaryLabel={t('terms.gate.logout')}
      onSecondary={onLogout}
    />
  );
}
