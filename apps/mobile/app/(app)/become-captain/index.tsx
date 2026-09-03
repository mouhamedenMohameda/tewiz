/**
 * Candidature Captain — onboarding v3.
 *
 * Deux photos, un envoi. Le formulaire d'avant (nom + plaque + marque +
 * modèle + année + couleur + places) a disparu : tout cela figure sur la
 * carte grise que le candidat photographie ici, et le lui faire recopier
 * avant même de savoir s'il est accepté coûtait ~34 taps pour un « peut-être ».
 * Il déclarera son véhicule après acceptation (écran complete-profile), quand
 * il a une raison de le faire.
 *
 * Le parcours tient en 8 taps, sans rien à saisir :
 *   carte « Devenir Captain » · permis (carte, déclencheur, valider)
 *   · carte grise (carte, déclencheur, valider) · envoyer.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, Alert, Pressable, RefreshControl, ScrollView, View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, DateField, PlainText as Text, ScreenHeader, Sheet, wrapRow } from '@/components/ui';
import { DocumentCard, useDocumentUpload, type PendingUpload } from '@/components/DocumentCapture';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  type ApplicationDto, type ApplicationStatus,
  docsComplete, docTypesForStage,
} from '@/lib/kyc';
import { APP_NAME } from '@/lib/brand';
import { TermsSheet } from '@/components/TermsSheet';
import { acceptTerms, useTermsStatus } from '@/lib/terms';
import { apiErrorMessage } from '@/lib/apiError';
import { colors, radius, spacing, statusTone } from '@/theme';
import { useThemeRepaint } from '@/theme/ThemeProvider';

export default function BecomeCaptainHome() {
  useThemeRepaint();
  const router = useRouter();
  const { t } = useTranslation();
  const user = useAuth((s) => s.user);
  const setUser = useAuth((s) => s.setUser);
  const setActiveMode = useAuth((s) => s.setActiveMode);

  const [app, setApp] = useState<ApplicationDto | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const [pendingUpload, setPendingUpload] = useState<PendingUpload | null>(null);
  const [expiryInput, setExpiryInput] = useState('');

  const { status: termsStatus, setStatus: setTermsStatus } = useTermsStatus();
  const [termsOpen, setTermsOpen] = useState(false);
  const [acceptingTerms, setAcceptingTerms] = useState(false);
  const termsAccepted = termsStatus?.accepted ?? false;

  // Le brouillon est créé à l'ouverture, pas sur un bouton « Commencer ».
  // Personne n'ouvre cet écran pour renoncer devant un écran vide : c'était un
  // tap payé pour rien. POST /captain/applications est idempotent (il renvoie
  // la candidature ouverte s'il y en a une), l'appeler au montage est sûr.
  // `creatingRef` évite le double appel du montage + useFocusEffect.
  const creatingRef = useRef(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get<ApplicationDto | null>('/captain/applications/me');
      if (r.data) { setApp(r.data); return; }

      if (creatingRef.current) return;
      creatingRef.current = true;
      try {
        const c = await api.post<ApplicationDto>('/captain/applications');
        setApp(c.data);
      } finally {
        creatingRef.current = false;
      }
    } catch (e: any) {
      Alert.alert(t('common.error'), apiErrorMessage(e, t, t('becomeCaptain.loadFail')));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    if (app?.status !== 'approved') return;
    // Accepté → on bascule le compte en Captain. Ce qui reste à fournir
    // (véhicule, assurance, photo) est réclamé côté Captain, pas ici.
    (async () => {
      if (user && user.role !== 'captain') await setUser({ ...user, role: 'captain' });
      await setActiveMode('captain');
      router.replace('/(app)/captain');
    })();
  }, [app?.status, router, setUser, setActiveMode, user]);

  const { uploadingType, capture, upload } = useDocumentUpload({
    onUploaded: load,
    onNeedExpiry: (p) => { setPendingUpload(p); setExpiryInput(''); },
  });

  async function onAcceptTerms() {
    setAcceptingTerms(true);
    try {
      setTermsStatus(await acceptTerms());
      setTermsOpen(false);
    } catch (e: any) {
      Alert.alert(
        t('common.error'),
        e.response?.status === 409
          ? t('terms.updateRequired')
          : apiErrorMessage(e, t, t('terms.acceptFail')),
      );
    } finally {
      setAcceptingTerms(false);
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

  async function submitApplication() {
    if (!app) return;
    if (!docsComplete(app)) {
      Alert.alert(t('becomeCaptain.incompleteTitle'), t('becomeCaptain.completeDocsFirst'));
      return;
    }
    setSubmitting(true);
    try {
      // Le tap sur « Envoyer » vaut acceptation : la mention et le lien vers
      // les conditions sont juste au-dessus du bouton. Le serveur exige
      // toujours un consentement enregistré pour la version courante — on
      // l'enregistre donc ici, avant l'envoi, plutôt que de faire ouvrir la
      // feuille au candidat (2 taps de plus pour le même engagement).
      if (!termsAccepted) setTermsStatus(await acceptTerms());

      const r = await api.post<ApplicationDto>('/captain/applications/me/submit');
      setApp(r.data);
      Alert.alert(t('becomeCaptain.submittedTitle'), t('becomeCaptain.submittedBody'));
    } catch (e: any) {
      const missing = e.response?.data?.error?.details?.missing as string[] | undefined;
      if (missing?.length) {
        Alert.alert(
          t('becomeCaptain.incompleteTitle'),
          t('becomeCaptain.missingPrefix', { items: missing.join('\n• ') }),
        );
      } else {
        // Un 5xx ou une coupure réseau atterrit ici aussi — « complétez votre
        // dossier » serait un mensonge. On ne parle de dossier incomplet que
        // si le serveur l'a dit.
        const incomplete = e.response?.status === 400 || e.response?.status === 422;
        Alert.alert(
          incomplete ? t('becomeCaptain.incompleteTitle') : t('common.error'),
          apiErrorMessage(e, t, t('becomeCaptain.completeDocsFirst')),
        );
      }
    } finally {
      setSubmitting(false);
    }
  }

  const today = new Date();
  const minExpiry = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  const maxExpiry = `${today.getFullYear() + 30}-12-31`;
  const monthLabels = useMemo(
    () => (t('months', { returnObjects: true }) as unknown) as string[],
    [t],
  );

  if (loading) {
    return (
      <SafeAreaView style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator />
      </SafeAreaView>
    );
  }

  const editable = !!app && (app.status === 'draft' || app.status === 'needs_correction');
  const requiredDocs = app ? docTypesForStage(app, 'application') : [];
  const byType = new Map((app?.documents ?? []).map((d) => [d.type, d] as const));
  const allDocsIn = !!app && docsComplete(app);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.canvas }}>
      <ScrollView
        contentContainerStyle={{ padding: 20, paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={false} onRefresh={load} />}
      >
        <ScreenHeader
          title={t('becomeCaptain.title', { app: APP_NAME })}
          subtitle={user?.phone ?? undefined}
          onBack={() => router.back()}
        />

        {app ? (
          <View style={{ marginTop: 16 }}>
            <StatusBanner status={app.status} />

            {app.status === 'needs_correction' && app.correctionNotes ? (
              <NoteCard tone="pending" title={t('becomeCaptain.correctionNotesTitle')} body={app.correctionNotes} />
            ) : null}
            {app.status === 'rejected' && app.rejectReason ? (
              <NoteCard tone="danger" title={t('becomeCaptain.rejectReason')} body={app.rejectReason} />
            ) : null}

            {editable ? (
              <>
                <Text style={{ fontSize: 15, color: colors.ink2, lineHeight: 22, marginTop: 20 }}>
                  {t('becomeCaptain.introV3', { app: APP_NAME })}
                </Text>

                <View style={{ flexDirection: wrapRow, flexWrap: 'wrap', gap: 12, marginTop: 20 }}>
                  {requiredDocs.map((type) => (
                    <DocumentCard
                      key={type}
                      type={type}
                      doc={byType.get(type)}
                      uploading={uploadingType === type}
                      editable={editable}
                      onCapture={(source) => capture(type, source)}
                    />
                  ))}
                </View>

                <Text style={{ fontSize: 13, color: colors.ink2, marginTop: 12, lineHeight: 19 }}>
                  {t('becomeCaptain.docs.laterHint')}
                </Text>

                {/* Consentement au fil du bouton : la mention est adjacente et
                    le texte reste accessible d'un tap sur le lien. */}
                <Text style={{ fontSize: 13, color: colors.ink2, marginTop: 24, lineHeight: 19 }}>
                  {t('becomeCaptain.consentPrefix')}{' '}
                  <Text
                    onPress={() => setTermsOpen(true)}
                    style={{ color: colors.ember, fontWeight: '700', textDecorationLine: 'underline' }}
                  >
                    {t('terms.checkboxLink')}
                  </Text>
                  {termsStatus?.acceptedAt ? (
                    <Text style={{ color: colors.ink2 }}>
                      {' · '}{t('terms.acceptedAt', { date: termsStatus.acceptedAt.slice(0, 10) })}
                    </Text>
                  ) : null}
                </Text>

                <Pressable
                  disabled={!allDocsIn || submitting}
                  onPress={submitApplication}
                  style={({ pressed }) => ({
                    marginTop: 12,
                    backgroundColor: pressed ? colors.emberDeep : colors.ember,
                    opacity: !allDocsIn || submitting ? 0.5 : 1,
                    paddingVertical: 16, borderRadius: radius.lg,
                    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
                  })}
                >
                  {submitting && <ActivityIndicator color="#fff" />}
                  <Text style={{ color: colors.white, fontSize: 15, fontWeight: '600' }}>
                    {allDocsIn ? t('becomeCaptain.submit') : t('becomeCaptain.completeDocsFirst')}
                  </Text>
                </Pressable>
              </>
            ) : null}
          </View>
        ) : null}
      </ScrollView>

      <TermsSheet
        visible={termsOpen}
        busy={acceptingTerms}
        onAccept={onAcceptTerms}
        onClose={() => setTermsOpen(false)}
      />

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

function NoteCard({ tone, title, body }: { tone: 'pending' | 'danger'; title: string; body: string }) {
  const bg = tone === 'danger' ? statusTone.failed.bg : statusTone.pending.bg;
  const fg = tone === 'danger' ? colors.danger : statusTone.pending.fg;
  const border = tone === 'danger' ? colors.dangerSoft : statusTone.pending.bg;
  return (
    <View style={{
      marginTop: 16, backgroundColor: bg, borderRadius: radius.md,
      padding: 16, borderWidth: 1, borderColor: border,
    }}>
      <Text style={{ fontSize: 13, fontWeight: '700', color: fg }}>{title}</Text>
      <Text style={{ fontSize: 13, color: fg, marginTop: 8, lineHeight: 20 }}>{body}</Text>
    </View>
  );
}

function StatusBanner({ status }: { status: ApplicationStatus }) {
  const { t } = useTranslation();
  const palette: Record<ApplicationStatus, { bg: string; fg: string }> = {
    draft:            { bg: statusTone.pending.bg, fg: statusTone.pending.fg },
    submitted:        { bg: statusTone.active.bg, fg: statusTone.active.fg },
    under_review:     { bg: statusTone.active.bg, fg: statusTone.active.fg },
    needs_correction: { bg: statusTone.pending.bg, fg: statusTone.pending.fg },
    approved:         { bg: statusTone.done.bg, fg: statusTone.done.fg },
    rejected:         { bg: colors.dangerSoft, fg: statusTone.failed.fg },
  };
  const s = palette[status];
  return (
    <View style={{ backgroundColor: s.bg, borderRadius: radius.md, padding: 16 }}>
      <Text style={{ color: s.fg, fontSize: 12, fontWeight: '700', letterSpacing: 0.5 }}>
        {t(`becomeCaptain.banner.${status}.label` as const).toUpperCase()}
      </Text>
      <Text style={{ color: s.fg, fontSize: 13, marginTop: 4, lineHeight: 20 }}>
        {t(`becomeCaptain.banner.${status}.desc` as const, { app: APP_NAME })}
      </Text>
    </View>
  );
}

function pad(n: number) { return n < 10 ? `0${n}` : String(n); }
