/**
 * Dataset collection screen (testers only).
 *
 * Records ground-truth samples for evaluating the Hassaniya voice-to-ride
 * pipeline. Two design decisions drive the whole flow:
 *
 * 1. THE ASSIGNMENT COMES BEFORE THE RECORDING, AND CARRIES NO PLACE NAMES.
 *    If a tester picked the POIs first, they would then pronounce the canonical
 *    label they had just read off the screen — "Marché Capitale", articulated —
 *    and the corpus would be full of speech no rider ever produces. The server
 *    assigns the *shape* (structure, noise, language, difficulty, zone); the
 *    tester supplies places from their own life and says them their own way.
 *
 * 2. ANNOTATION COMES AFTER, with playback available but not compulsory.
 *    An earlier version blocked submission until the clip had been replayed,
 *    reasoning that a mislabelled sample is worse than a missing one. That
 *    reasoning holds when the annotator did not produce the audio — it does not
 *    hold here, where the same person spoke five seconds earlier and knows
 *    exactly what they said. It bought no accuracy and taxed every single
 *    sample. The real guard against bad labels is the reviewer pass in
 *    admin-web, which listens to the audio without having recorded it.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useTranslation } from 'react-i18next';
import { Audio } from 'expo-av';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useVoiceRecorder } from '@/lib/useVoiceRecorder';
import { PoiPickerSheet } from '@/components/PoiPickerSheet';
import { AppText, Button, Card, Icon, Screen, ScreenHeader, TextField } from '@/components/ui';
import { colors, radius, spacing } from '@/theme';
import {
  getScenario, getStats, submitSample, setTranscript, listPendingTranscripts,
  type CollectorStats, type DatasetSample, type PoiOption, type Scenario,
  type ScenarioStructure,
} from '@/lib/voiceDataset';

type Phase = 'brief' | 'recording' | 'annotate' | 'uploading' | 'transcripts';

const MIN_RECORD_MS = 1500;
const MAX_RECORD_MS = 60_000;

/** Speaker metadata is typed once and reused — it must not cost a tap per sample. */
const SPEAKER_STORAGE_KEY = 'voiceDataset.speaker';

const STRUCTURES: ScenarioStructure[] = [
  'from_to', 'round_trip', 'pickup_only', 'destination_only', 'open_ride',
];

const GENDERS = ['f', 'm', 'other'] as const;
const AGE_BANDS = ['18_25', '26_40', '41_60', '60_plus'] as const;

export default function DatasetCollectScreen() {
  const router = useRouter();
  const { t } = useTranslation();

  const [phase, setPhase] = useState<Phase>('brief');
  const [scenario, setScenario] = useState<Scenario | null>(null);
  const [stats, setStats] = useState<CollectorStats | null>(null);
  const [loadingBrief, setLoadingBrief] = useState(true);

  // Annotation state
  const [clipUri, setClipUri] = useState<string | null>(null);
  const [clipDurationS, setClipDurationS] = useState(0);
  const [structure, setStructure] = useState<ScenarioStructure>('from_to');
  const [pickup, setPickup] = useState<PoiOption | null>(null);
  const [destination, setDestination] = useState<PoiOption | null>(null);
  const [transcript, setTranscriptText] = useState('');
  const [gender, setGender] = useState<string | null>(null);
  const [ageBand, setAgeBand] = useState<string | null>(null);
  const [picker, setPicker] = useState<'pickup' | 'destination' | null>(null);

  const isOpen = structure === 'open_ride';

  const loadBrief = useCallback(async () => {
    setLoadingBrief(true);
    try {
      const [next, counters] = await Promise.all([getScenario(), getStats()]);
      setScenario(next);
      setStructure(next.structure);
      setStats(counters);
    } catch {
      Alert.alert(t('rider.dataset.loadFailedTitle'), t('rider.dataset.loadFailedBody'));
    } finally {
      setLoadingBrief(false);
    }
  }, [t]);

  useEffect(() => { void loadBrief(); }, [loadBrief]);

  // Restore the speaker profile so it is typed once, not once per sample.
  useEffect(() => {
    AsyncStorage.getItem(SPEAKER_STORAGE_KEY)
      .then((raw) => {
        if (!raw) return;
        const saved = JSON.parse(raw) as { gender?: string; ageBand?: string };
        if (saved.gender) setGender(saved.gender);
        if (saved.ageBand) setAgeBand(saved.ageBand);
      })
      .catch(() => {
        // A corrupt or missing profile just means the tester picks it again.
      });
  }, []);

  const onClipReady = useCallback((uri: string | null, durationMs: number) => {
    if (!uri) return;
    if (durationMs < MIN_RECORD_MS) {
      Alert.alert(t('rider.dataset.tooShortTitle'), t('rider.dataset.tooShortBody'));
      setPhase('brief');
      return;
    }
    setClipUri(uri);
    setClipDurationS(Math.round(durationMs / 1000));
    setPhase('annotate');
  }, [t]);

  const recorder = useVoiceRecorder({
    maxDurationMs: MAX_RECORD_MS,
    onAutoStop: onClipReady,
  });

  const startRecording = useCallback(async () => {
    const ok = await recorder.start();
    if (ok) setPhase('recording');
  }, [recorder]);

  const stopRecording = useCallback(async () => {
    const uri = await recorder.stop();
    onClipReady(uri, recorder.durationMs);
  }, [recorder, onClipReady]);

  const resetAnnotation = useCallback(() => {
    setClipUri(null);
    setClipDurationS(0);
    setPickup(null);
    setDestination(null);
    setTranscriptText('');
  }, []);

  const discardClip = useCallback(() => {
    resetAnnotation();
    setPhase('brief');
    void loadBrief();
  }, [resetAnnotation, loadBrief]);

  const submit = useCallback(async () => {
    if (!clipUri || !scenario) return;
    setPhase('uploading');
    try {
      await submitSample({
        audioUri: clipUri,
        durationS: clipDurationS,
        pickupPoiId: pickup?.id ?? null,
        destinationPoiId: isOpen ? null : destination?.id ?? null,
        isOpen,
        transcriptGold: transcript.trim() || null,
        // The recorded structure overrides the assigned one: if what came out
        // was a plain "from → to" when a round trip was asked for, the row must
        // describe the audio, not the request.
        scenario: { ...scenario, structure },
        speakerGender: gender,
        speakerAgeBand: ageBand,
      });
      await AsyncStorage.setItem(
        SPEAKER_STORAGE_KEY,
        JSON.stringify({ gender, ageBand }),
      ).catch(() => {
        // Losing the cached profile costs two taps next time, nothing more.
      });
      resetAnnotation();
      setPhase('brief');
      void loadBrief();
    } catch (e: unknown) {
      const err = (e as { response?: { data?: { error?: { message?: string } } } })
        .response?.data?.error;
      Alert.alert(
        t('rider.dataset.submitFailedTitle'),
        err?.message ?? t('rider.dataset.submitFailedBody'),
      );
      setPhase('annotate');
    }
  }, [
    clipUri, clipDurationS, scenario, structure, pickup, destination, isOpen,
    transcript, gender, ageBand, resetAnnotation, loadBrief, t,
  ]);

  // Enough ground truth to be worth storing: an open ride needs no endpoints,
  // a round trip needs both, everything else needs at least one.
  const annotationComplete = isOpen
    ? true
    : structure === 'round_trip'
      ? Boolean(pickup && destination)
      : Boolean(pickup || destination);

  return (
    <Screen scroll>
      <ScreenHeader
        title={t('rider.dataset.title')}
        subtitle={t('rider.dataset.subtitle')}
        onBack={() => router.back()}
      />

      {phase === 'brief' && (
        <BriefView
          scenario={scenario}
          stats={stats}
          loading={loadingBrief}
          onStart={startRecording}
          onShuffle={loadBrief}
          onOpenTranscripts={() => setPhase('transcripts')}
          error={recorder.error}
        />
      )}

      {phase === 'recording' && (
        <RecordingView
          durationMs={recorder.durationMs}
          onStop={stopRecording}
        />
      )}

      {phase === 'annotate' && clipUri && (
        <AnnotateView
          clipUri={clipUri}
          durationS={clipDurationS}
          structure={structure}
          onStructure={setStructure}
          pickup={pickup}
          destination={destination}
          isOpen={isOpen}
          onPickPickup={() => setPicker('pickup')}
          onPickDestination={() => setPicker('destination')}
          onClearPickup={() => setPickup(null)}
          onClearDestination={() => setDestination(null)}
          transcript={transcript}
          onTranscript={setTranscriptText}
          gender={gender}
          onGender={setGender}
          ageBand={ageBand}
          onAgeBand={setAgeBand}
          canSubmit={annotationComplete}
          onSubmit={submit}
          onDiscard={discardClip}
        />
      )}

      {phase === 'uploading' && (
        <View style={{ alignItems: 'center', paddingVertical: spacing.mega }}>
          <ActivityIndicator color={colors.ember} size="large" />
          <AppText variant="body" color={colors.muted} style={{ marginTop: spacing.base }}>
            {t('rider.dataset.uploading')}
          </AppText>
        </View>
      )}

      {phase === 'transcripts' && (
        <TranscriptQueue onDone={() => { setPhase('brief'); void loadBrief(); }} />
      )}

      {scenario ? (
        <PoiPickerSheet
          visible={picker !== null}
          zone={scenario.zone}
          title={picker === 'pickup'
            ? t('rider.dataset.pickupTitle')
            : t('rider.dataset.destinationTitle')}
          onSelect={(poi) => {
            if (picker === 'pickup') setPickup(poi);
            else setDestination(poi);
          }}
          onClose={() => setPicker(null)}
        />
      ) : null}
    </Screen>
  );
}

// ── Brief ────────────────────────────────────────────────────────────────────

function BriefView({
  scenario, stats, loading, onStart, onShuffle, onOpenTranscripts, error,
}: {
  scenario: Scenario | null;
  stats: CollectorStats | null;
  loading: boolean;
  onStart: () => void;
  onShuffle: () => void;
  onOpenTranscripts: () => void;
  error: string | null;
}) {
  const { t } = useTranslation();

  if (loading && !scenario) {
    return <ActivityIndicator color={colors.ember} style={{ marginTop: spacing.mega }} />;
  }
  if (!scenario) {
    return (
      <Button title={t('rider.dataset.retry')} variant="secondary" icon="refresh" onPress={onShuffle} />
    );
  }

  const pendingTranscripts = stats ? stats.total - stats.withTranscript : 0;

  return (
    <View style={{ gap: spacing.base }}>
      <Card>
        <AppText variant="overline" color={colors.ember}>
          {t('rider.dataset.assignment')}
        </AppText>

        <View style={{ gap: spacing.md, marginTop: spacing.md }}>
          <BriefRow
            icon="ride"
            label={t('rider.dataset.axis.structure')}
            value={t(`rider.dataset.structures.${scenario.structure}`)}
          />
          <BriefRow
            icon="voice"
            label={t('rider.dataset.axis.noise')}
            value={t(`rider.dataset.noises.${scenario.noise}`)}
          />
          <BriefRow
            icon="globe"
            label={t('rider.dataset.axis.language')}
            value={t(`rider.dataset.languages.${scenario.language}`)}
          />
          <BriefRow
            icon="tune"
            label={t('rider.dataset.axis.difficulty')}
            value={t(`rider.dataset.difficulties.${scenario.difficulty}`)}
          />
          <BriefRow
            icon="pin"
            label={t('rider.dataset.axis.zone')}
            value={t(`rider.dataset.zones.${scenario.zone}`)}
          />
        </View>

        <View style={{
          marginTop: spacing.base, padding: spacing.md,
          backgroundColor: colors.surfaceAlt, borderRadius: radius.md,
        }}>
          <AppText variant="caption" color={colors.ink2}>
            {t('rider.dataset.speakNaturally')}
          </AppText>
        </View>
      </Card>

      {error ? (
        <AppText variant="caption" color={colors.danger}>{error}</AppText>
      ) : null}

      <Button title={t('rider.dataset.startRecording')} icon="voice" onPress={onStart} fullWidth />
      <Button
        title={t('rider.dataset.otherAssignment')}
        variant="ghost"
        icon="refresh"
        onPress={onShuffle}
      />

      {stats ? (
        <Card>
          <AppText variant="overline" color={colors.muted}>
            {t('rider.dataset.yourContribution')}
          </AppText>
          <View style={{ flexDirection: 'row', gap: spacing.lg, marginTop: spacing.md }}>
            <Counter label={t('rider.dataset.recorded')} value={stats.total} />
            <Counter label={t('rider.dataset.validated')} value={stats.validated} />
            <Counter label={t('rider.dataset.transcribed')} value={stats.withTranscript} />
          </View>

          {pendingTranscripts > 0 ? (
            <Button
              title={t('rider.dataset.fillTranscripts', { count: pendingTranscripts })}
              variant="secondary"
              icon="document"
              size="sm"
              onPress={onOpenTranscripts}
              style={{ marginTop: spacing.base }}
            />
          ) : null}
        </Card>
      ) : null}
    </View>
  );
}

function BriefRow({ icon, label, value }: {
  icon: 'ride' | 'voice' | 'globe' | 'tune' | 'pin';
  label: string;
  value: string;
}) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.md }}>
      <Icon name={icon} size={18} color={colors.muted} />
      <View style={{ flex: 1 }}>
        <AppText variant="caption" color={colors.muted}>{label}</AppText>
        <AppText variant="body">{value}</AppText>
      </View>
    </View>
  );
}

function Counter({ label, value }: { label: string; value: number }) {
  return (
    <View>
      <AppText variant="h2">{String(value)}</AppText>
      <AppText variant="caption" color={colors.muted}>{label}</AppText>
    </View>
  );
}

// ── Recording ────────────────────────────────────────────────────────────────

function RecordingView({ durationMs, onStop }: { durationMs: number; onStop: () => void }) {
  const { t } = useTranslation();
  const secs = Math.floor(durationMs / 1000);
  const mmss = `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`;

  return (
    <View style={{ alignItems: 'center', paddingVertical: spacing.xxl, gap: spacing.lg }}>
      <AppText variant="h1">{mmss}</AppText>
      <AppText variant="body" color={colors.muted} align="center" style={{ maxWidth: 280 }}>
        {t('rider.dataset.recordingHint')}
      </AppText>
      <Pressable
        onPress={onStop}
        style={{
          width: 120, height: 120, borderRadius: 60,
          backgroundColor: colors.danger,
          alignItems: 'center', justifyContent: 'center',
        }}
      >
        <Icon name="close" size={48} color={colors.white} />
      </Pressable>
      <AppText variant="caption" color={colors.muted}>
        {t('rider.dataset.tapToStop')}
      </AppText>
    </View>
  );
}

// ── Annotation ───────────────────────────────────────────────────────────────

interface AnnotateViewProps {
  clipUri: string;
  durationS: number;
  structure: ScenarioStructure;
  onStructure: (s: ScenarioStructure) => void;
  pickup: PoiOption | null;
  destination: PoiOption | null;
  isOpen: boolean;
  onPickPickup: () => void;
  onPickDestination: () => void;
  onClearPickup: () => void;
  onClearDestination: () => void;
  transcript: string;
  onTranscript: (v: string) => void;
  gender: string | null;
  onGender: (v: string) => void;
  ageBand: string | null;
  onAgeBand: (v: string) => void;
  canSubmit: boolean;
  onSubmit: () => void;
  onDiscard: () => void;
}

function AnnotateView(props: AnnotateViewProps) {
  const { t } = useTranslation();

  return (
    <View style={{ gap: spacing.base }}>
      <ClipPlayer
        uri={props.clipUri}
        durationS={props.durationS}
      />

      <Card>
        <AppText variant="overline" color={colors.muted}>
          {t('rider.dataset.axis.structure')}
        </AppText>
        <ChipRow
          options={STRUCTURES}
          value={props.structure}
          onChange={(v) => props.onStructure(v as ScenarioStructure)}
          labelFor={(v) => t(`rider.dataset.structures.${v}`)}
        />
      </Card>

      <Card>
        <AppText variant="overline" color={colors.muted}>
          {t('rider.dataset.groundTruth')}
        </AppText>

        <PoiRow
          label={t('rider.dataset.pickupTitle')}
          poi={props.pickup}
          onPress={props.onPickPickup}
          onClear={props.onClearPickup}
        />

        {props.isOpen ? (
          <AppText variant="caption" color={colors.muted} style={{ marginTop: spacing.md }}>
            {t('rider.dataset.openRideNoDestination')}
          </AppText>
        ) : (
          <PoiRow
            label={t('rider.dataset.destinationTitle')}
            poi={props.destination}
            onPress={props.onPickDestination}
            onClear={props.onClearDestination}
          />
        )}
      </Card>

      <Card>
        <AppText variant="overline" color={colors.muted}>
          {t('rider.dataset.transcriptLabel')}
        </AppText>
        <AppText variant="caption" color={colors.muted} style={{ marginBottom: spacing.sm }}>
          {t('rider.dataset.transcriptHint')}
        </AppText>
        <TextField
          placeholder={t('rider.dataset.transcriptPlaceholder')}
          value={props.transcript}
          onChangeText={props.onTranscript}
          multiline
          numberOfLines={3}
          autoCorrect={false}
        />
      </Card>

      <Card>
        <AppText variant="overline" color={colors.muted}>
          {t('rider.dataset.speaker')}
        </AppText>
        <ChipRow
          options={[...GENDERS]}
          value={props.gender}
          onChange={props.onGender}
          labelFor={(v) => t(`rider.dataset.genders.${v}`)}
        />
        <ChipRow
          options={[...AGE_BANDS]}
          value={props.ageBand}
          onChange={props.onAgeBand}
          labelFor={(v) => t(`rider.dataset.ageBands.${v}`)}
        />
      </Card>

      <Button
        title={t('rider.dataset.submit')}
        icon="check"
        onPress={props.onSubmit}
        disabled={!props.canSubmit}
        fullWidth
      />
      <Button
        title={t('rider.dataset.discard')}
        variant="ghost"
        icon="trash"
        onPress={props.onDiscard}
      />
    </View>
  );
}

/**
 * Playback of the clip just recorded.
 *
 * Owns its Sound instance and unloads it on unmount — an expo-av Sound left
 * loaded holds the audio session, and the next recording then fails to start
 * on iOS.
 */
function ClipPlayer({ uri, durationS }: {
  uri: string;
  durationS: number;
}) {
  const { t } = useTranslation();
  const soundRef = useRef<Audio.Sound | null>(null);
  const [playing, setPlaying] = useState(false);

  useEffect(() => () => {
    void soundRef.current?.unloadAsync();
    soundRef.current = null;
  }, []);

  const play = useCallback(async () => {
    try {
      if (!soundRef.current) {
        const { sound } = await Audio.Sound.createAsync({ uri });
        soundRef.current = sound;
        sound.setOnPlaybackStatusUpdate((status) => {
          if (!status.isLoaded) return;
          setPlaying(status.isPlaying);
          if (status.didJustFinish) setPlaying(false);
        });
      }
      await soundRef.current.replayAsync();
    } catch {
      // Playback is a convenience, not a gate — a failure here must not block
      // the sample. Reset the button and let the tester carry on.
      setPlaying(false);
    }
  }, [uri]);

  return (
    <Card>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing.base }}>
        <Pressable
          onPress={play}
          style={{
            width: 52, height: 52, borderRadius: 26,
            backgroundColor: colors.ember,
            alignItems: 'center', justifyContent: 'center',
          }}
        >
          <Icon name={playing ? 'close' : 'arrow'} size={24} color={colors.white} />
        </Pressable>
        <View style={{ flex: 1 }}>
          <AppText variant="body">{t('rider.dataset.yourClip', { seconds: durationS })}</AppText>
          <AppText variant="caption" color={colors.muted}>
            {t('rider.dataset.replayHint')}
          </AppText>
        </View>
      </View>
    </Card>
  );
}

function PoiRow({ label, poi, onPress, onClear }: {
  label: string;
  poi: PoiOption | null;
  onPress: () => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Pressable
      onPress={onPress}
      style={{
        flexDirection: 'row', alignItems: 'center', gap: spacing.md,
        marginTop: spacing.md, padding: spacing.md,
        borderRadius: radius.md, borderWidth: 1,
        borderColor: poi ? colors.ember : colors.line,
        backgroundColor: poi ? colors.emberSoft : colors.surfaceAlt,
      }}
    >
      <Icon name="pin" size={18} color={poi ? colors.ember : colors.muted} />
      <View style={{ flex: 1 }}>
        <AppText variant="caption" color={colors.muted}>{label}</AppText>
        <AppText variant="body" numberOfLines={1}>
          {poi?.label ?? t('rider.dataset.choosePlace')}
        </AppText>
      </View>
      {poi ? (
        <Pressable onPress={onClear} hitSlop={10}>
          <Icon name="close" size={18} color={colors.muted} />
        </Pressable>
      ) : (
        <Icon name="chevron" size={18} color={colors.muted} />
      )}
    </Pressable>
  );
}

function ChipRow({ options, value, onChange, labelFor }: {
  options: readonly string[];
  value: string | null;
  onChange: (v: string) => void;
  labelFor: (v: string) => string;
}) {
  return (
    <View style={{
      flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm,
    }}>
      {options.map((option) => {
        const active = option === value;
        return (
          <Pressable
            key={option}
            onPress={() => onChange(option)}
            style={{
              paddingVertical: spacing.sm, paddingHorizontal: spacing.base,
              borderRadius: radius.pill,
              backgroundColor: active ? colors.ember : colors.surfaceAlt,
              borderWidth: 1, borderColor: active ? colors.ember : colors.line,
            }}
          >
            <AppText variant="caption" color={active ? colors.onEmber : colors.ink}>
              {labelFor(option)}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

// ── Pending transcripts ──────────────────────────────────────────────────────

/**
 * The catch-up queue for transcripts skipped at recording time.
 *
 * Skipping is allowed on purpose: an Arabic phone keyboard is slow enough that
 * requiring a transcript before submission would cost more samples than the
 * transcripts are worth. Only ASR fine-tuning needs them; the headline metrics
 * (exact-pair POI accuracy, fare error) are computed from the POI labels alone.
 */
function TranscriptQueue({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const [items, setItems] = useState<DatasetSample[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    listPendingTranscripts().then(setItems).catch(() => setItems([]));
  }, []);

  const save = useCallback(async (id: string) => {
    const text = (drafts[id] ?? '').trim();
    if (!text) return;
    setSavingId(id);
    try {
      await setTranscript(id, text);
      setItems((prev) => (prev ?? []).filter((s) => s.id !== id));
    } catch {
      Alert.alert(t('rider.dataset.submitFailedTitle'), t('rider.dataset.submitFailedBody'));
    } finally {
      setSavingId(null);
    }
  }, [drafts, t]);

  if (items === null) {
    return <ActivityIndicator color={colors.ember} style={{ marginTop: spacing.mega }} />;
  }

  return (
    <View style={{ gap: spacing.base }}>
      {items.length === 0 ? (
        <AppText variant="body" color={colors.muted} align="center" style={{ marginVertical: spacing.xl }}>
          {t('rider.dataset.noPendingTranscripts')}
        </AppText>
      ) : null}

      {items.map((sample) => (
        <Card key={sample.id}>
          <AppText variant="caption" color={colors.muted}>
            {[
              sample.pickup?.label,
              sample.isOpen ? t('rider.dataset.structures.open_ride') : sample.destination?.label,
            ].filter(Boolean).join(' → ')}
          </AppText>
          <TextField
            placeholder={t('rider.dataset.transcriptPlaceholder')}
            value={drafts[sample.id] ?? ''}
            onChangeText={(v) => setDrafts((prev) => ({ ...prev, [sample.id]: v }))}
            multiline
            numberOfLines={3}
            autoCorrect={false}
            containerStyle={{ marginTop: spacing.sm }}
          />
          <Button
            title={t('rider.dataset.saveTranscript')}
            size="sm"
            icon="check"
            busy={savingId === sample.id}
            disabled={!(drafts[sample.id] ?? '').trim()}
            onPress={() => save(sample.id)}
            style={{ marginTop: spacing.sm }}
          />
        </Card>
      ))}

      <Button title={t('rider.dataset.backToRecording')} variant="secondary" icon="chevronBack" onPress={onDone} />
    </View>
  );
}
