/**
 * CaptainPermissions — the one screen that replaces the scattered pop-ups.
 *
 * The OS will not let us merge GPS, background location, notifications and the
 * microphone into a single dialog (see lib/captainPermissions.ts for why). What
 * this panel does instead is collapse them into a single CAPTAIN ACTION: one
 * explained list, one "Tout autoriser" button, and the system prompts fire back
 * to back from there. From the captain's point of view it is one step, at a
 * moment they expect it, instead of an ambush on four different screens.
 *
 * Each row states what the permission is FOR, not what it is called — "pour
 * recevoir les courses proches de vous" converts far better than "Localisation",
 * and Play's disclosure policy wants the purpose stated anyway.
 *
 * Rows that can no longer be prompted (denied for good, or Android 11+
 * background location) turn into a "Corriger" action that opens the system
 * settings; the panel re-reads the statuses on app resume, so coming back from
 * Settings ticks the row without any further tap.
 *
 * Skipping is always allowed. Going online re-enforces the mandatory
 * permissions on its own (app/(app)/captain/index.tsx), so a skip can never
 * leave a captain online-but-untrackable — it just defers the ask.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { AppText, Button, Card, Icon, Screen } from '@/components/ui';
import { APP_NAME } from '@/lib/brand';
import {
  CAPTAIN_PERMISSIONS,
  allRequiredGranted,
  isPermissionOnboardingDone,
  markPermissionOnboardingDone,
  openAppSettings,
  readCaptainPermissions,
  requestAllCaptainPermissions,
  requestCaptainPermission,
  type CaptainPermissionKey,
  type PermStatuses,
} from '@/lib/captainPermissions';
import { colors, radius, spacing } from '@/theme';

const EMPTY: PermStatuses = {
  location: 'undetermined',
  always: 'undetermined',
  notifications: 'undetermined',
  microphone: 'undetermined',
};

export interface CaptainPermissionsProps {
  /**
   * `onboarding` is the one-time welcome (primary CTA + "Plus tard").
   * `settings` is the recovery view reached from the settings screen — no skip,
   * just a close action.
   */
  mode?: 'onboarding' | 'settings';
  /** Called when the captain is done — accepted everything, or skipped. */
  onDone?: () => void;
}

export function CaptainPermissions({ mode = 'onboarding', onDone }: CaptainPermissionsProps) {
  const { t } = useTranslation();
  const [statuses, setStatuses] = useState<PermStatuses>(EMPTY);
  // Which rows can no longer be prompted and need the settings page instead.
  const [stuck, setStuck] = useState<CaptainPermissionKey[]>([]);
  // Which rows the native layer refuses to even ask for — an app binary that
  // predates the feature. Settings won't help; only a new build will, so the
  // row says that instead of pretending the captain refused.
  const [unavailable, setUnavailable] = useState<CaptainPermissionKey[]>([]);
  const [busy, setBusy] = useState<CaptainPermissionKey | 'all' | null>(null);
  // Set while WE are showing a system prompt, so the AppState listener doesn't
  // re-read (and race the in-flight request) every time a dialog steals focus.
  const requesting = useRef(false);

  const refresh = useCallback(async () => {
    const next = await readCaptainPermissions();
    setStatuses(next);
    // A row that just got granted is no longer stuck / unavailable.
    setStuck((prev) => prev.filter((k) => next[k] !== 'granted'));
    setUnavailable((prev) => prev.filter((k) => next[k] !== 'granted'));
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // Coming back from the system settings must tick the rows without a tap.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' && !requesting.current) void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  async function grantAll() {
    setBusy('all');
    requesting.current = true;
    try {
      const res = await requestAllCaptainPermissions((key, out) => {
        // Tick each row the moment its prompt is answered, so the captain sees
        // the list filling in rather than a frozen screen behind four dialogs.
        setStatuses((prev) => ({ ...prev, [key]: out.status }));
      });
      setStatuses(res.statuses);
      setStuck(res.needsSettings);
      setUnavailable(res.unavailable);
    } finally {
      requesting.current = false;
      setBusy(null);
    }
  }

  async function grantOne(key: CaptainPermissionKey) {
    setBusy(key);
    requesting.current = true;
    try {
      const out = await requestCaptainPermission(key, statuses);
      setStatuses((prev) => ({ ...prev, [key]: out.status }));
      setStuck((prev) => (out.needsSettings
        ? (prev.includes(key) ? prev : [...prev, key])
        : prev.filter((k) => k !== key)));
      setUnavailable((prev) => (out.unavailable
        ? (prev.includes(key) ? prev : [...prev, key])
        : prev.filter((k) => k !== key)));
    } finally {
      requesting.current = false;
      setBusy(null);
    }
  }

  async function finish() {
    await markPermissionOnboardingDone();
    onDone?.();
  }

  const done = allRequiredGranted(statuses);

  return (
    <Screen scroll background={colors.canvas}>
      <View style={{ paddingBottom: spacing.xxl }}>
        <View style={{
          width: 56, height: 56, borderRadius: radius.lg,
          backgroundColor: colors.espresso,
          alignItems: 'center', justifyContent: 'center',
          marginBottom: spacing.base,
        }}>
          <Icon name="shield" size={30} color={colors.saffron} />
        </View>

        <AppText variant="h1">{t('captain.permissions.title')}</AppText>
        <AppText variant="body" color={colors.muted} style={{ marginTop: spacing.sm }}>
          {t('captain.permissions.intro', { app: APP_NAME })}
        </AppText>

        <View style={{ marginTop: spacing.xl, gap: spacing.md }}>
          {CAPTAIN_PERMISSIONS.map((p) => (
            <PermissionRow
              key={p.key}
              icon={p.icon}
              title={t(`captain.permissions.items.${p.key}.title`)}
              why={t(`captain.permissions.items.${p.key}.why`, { app: APP_NAME })}
              optional={!p.required}
              status={statuses[p.key]}
              stuck={stuck.includes(p.key)}
              unavailable={unavailable.includes(p.key)}
              busy={busy === p.key || busy === 'all'}
              // Foreground location gates the background one: until it is
              // granted, the OS rejects the request, so we don't offer it.
              blocked={p.key === 'always' && statuses.location !== 'granted'}
              onPress={() => void grantOne(p.key)}
              onSettings={() => void openAppSettings()}
            />
          ))}
        </View>

        <View style={{ marginTop: spacing.xl, gap: spacing.sm }}>
          {done ? (
            <Button
              title={t(mode === 'settings' ? 'common.close' : 'captain.permissions.start')}
              icon="check"
              onPress={() => void finish()}
            />
          ) : (
            <Button
              title={t('captain.permissions.grantAll')}
              icon="shield"
              busy={busy === 'all'}
              onPress={() => void grantAll()}
            />
          )}

          {mode === 'onboarding' && !done ? (
            <Button
              title={t('captain.permissions.later')}
              variant="ghost"
              disabled={busy !== null}
              onPress={() => void finish()}
            />
          ) : null}

          {mode === 'settings' && !done ? (
            <Button
              title={t('common.close')}
              variant="ghost"
              disabled={busy !== null}
              onPress={() => onDone?.()}
            />
          ) : null}
        </View>

        {!done ? (
          <AppText
            variant="caption"
            color={colors.muted}
            style={{ marginTop: spacing.md, textAlign: 'center' }}
          >
            {t('captain.permissions.footnote')}
          </AppText>
        ) : null}
      </View>
    </Screen>
  );
}

/* ------------------------------------------------------------------ */

interface RowProps {
  icon: 'pin' | 'map' | 'bell' | 'voice';
  title: string;
  why: string;
  optional: boolean;
  status: PermStatuses[CaptainPermissionKey];
  stuck: boolean;
  unavailable: boolean;
  busy: boolean;
  blocked: boolean;
  onPress: () => void;
  onSettings: () => void;
}

function PermissionRow({
  icon, title, why, optional, status, stuck, unavailable, busy, blocked, onPress, onSettings,
}: RowProps) {
  const { t } = useTranslation();
  const granted = status === 'granted';
  // "Needs the settings page" = the OS won't prompt again (denied for good, or
  // Android 11+ background location). `unavailable` is a different failure —
  // the build can't ask at all — and settings would be a dead end, so it wins.
  const needsSettings = !granted && !unavailable && (stuck || status === 'denied');

  const tone = granted
    ? colors.success
    : unavailable ? colors.danger : needsSettings ? colors.warning : colors.muted;

  return (
    <Card
      padding={spacing.base}
      borderColor={granted ? colors.successSoft : colors.line}
    >
      <View style={{ flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md }}>
        <View style={{
          width: 40, height: 40, borderRadius: radius.md,
          backgroundColor: granted ? colors.successSoft : colors.surfaceAlt,
          alignItems: 'center', justifyContent: 'center',
        }}>
          <Icon name={granted ? 'check' : icon} size={21} color={tone} />
        </View>

        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.sm }}>
            <AppText variant="bodyStrong" style={{ flexShrink: 1 }}>{title}</AppText>
            {optional ? (
              <View style={{
                paddingHorizontal: spacing.sm, paddingVertical: 2,
                borderRadius: radius.pill, backgroundColor: colors.surfaceAlt,
              }}>
                <AppText variant="caption" color={colors.muted}>
                  {t('captain.permissions.optional')}
                </AppText>
              </View>
            ) : null}
          </View>

          <AppText variant="caption" color={colors.muted} style={{ marginTop: 2 }}>
            {why}
          </AppText>

          {granted ? (
            <AppText variant="caption" color={colors.success} style={{ marginTop: spacing.sm }}>
              {t('captain.permissions.granted')}
            </AppText>
          ) : unavailable ? (
            <AppText variant="caption" color={colors.danger} style={{ marginTop: spacing.sm }}>
              {t('captain.permissions.unavailable')}
            </AppText>
          ) : blocked ? (
            <AppText variant="caption" color={colors.muted} style={{ marginTop: spacing.sm }}>
              {t('captain.permissions.needsLocationFirst')}
            </AppText>
          ) : (
            <Button
              title={t(needsSettings ? 'captain.permissions.fix' : 'captain.permissions.allow')}
              variant="secondary"
              size="sm"
              fullWidth={false}
              busy={busy}
              onPress={needsSettings ? onSettings : onPress}
              style={{ marginTop: spacing.sm, alignSelf: 'flex-start' }}
            />
          )}
        </View>
      </View>
    </Card>
  );
}

/**
 * Gate — mounted at the captain layout root. Shows the panel once, on the first
 * captain session, and never again after the captain has answered it.
 *
 * Fail-open like the other captain gates: any read error leaves it hidden
 * rather than blocking the app behind a permissions wall.
 */
export function CaptainPermissionsGate() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        if (await isPermissionOnboardingDone()) return;
        // Nothing to onboard if the captain already granted everything on a
        // previous build — mark it done silently instead of showing a panel of
        // green ticks.
        const statuses = await readCaptainPermissions();
        if (allRequiredGranted(statuses)) {
          await markPermissionOnboardingDone();
          return;
        }
        setShow(true);
      } catch {
        // fail-open
      }
    })();
  }, []);

  if (!show) return null;

  return (
    <View style={{
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      backgroundColor: colors.canvas,
    }}>
      <CaptainPermissions mode="onboarding" onDone={() => setShow(false)} />
    </View>
  );
}
