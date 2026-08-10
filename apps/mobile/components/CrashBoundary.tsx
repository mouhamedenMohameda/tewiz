import { Component, type ReactNode } from 'react';
import { ScrollView, Text, View, StyleSheet } from 'react-native';
import { saveCrash } from '@/lib/crash-reporter';
import { reportError } from '@/lib/sentry';
import { i18n } from '@/lib/i18n';
import { colors } from '@/theme';

interface State {
  error: Error | null;
}

/**
 * React error boundary that:
 *   1. Persists the error so it can be shown on the next launch.
 *   2. Renders a readable fallback UI with the stacktrace
 *      (so the user can screenshot it even if the persisted entry is lost).
 */
export class CrashBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error): void {
    void saveCrash('react', error);
    reportError(error, { source: 'react-error-boundary' });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    // i18n may not be initialised yet if the crash happened during boot — fall
    // back to the source-language string via i18n.t (returns the key untouched
    // if no resource is loaded yet).
    const t = i18n.t.bind(i18n);

    return (
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
      >
        <Text style={styles.title}>{t('crash.title')}</Text>
        <Text style={styles.label}>{t('crash.message')}</Text>
        <Text selectable style={styles.message}>
          {error.message}
        </Text>
        {error.stack ? (
          <>
            <Text style={styles.label}>{t('crash.stack')}</Text>
            <Text selectable style={styles.stack}>
              {error.stack}
            </Text>
          </>
        ) : null}
        <Text style={styles.hint}>
          {t('crash.hint')}
        </Text>
      </ScrollView>
    );
  }
}

/**
 * Deliberately OUTSIDE the "Sahara Solaire" palette.
 *
 * This screen only ever appears when the app has already failed, and it exists
 * to be read and screenshotted — a stacktrace on warm sand is harder to read
 * and, worse, looks like a designed part of the product. The neutral dark
 * console look tells the user at a glance that this is not a normal screen.
 * Two reasons to keep the values local rather than adding console greys to the
 * theme: nothing else in the app should ever reach for them, and a fallback
 * renderer should depend on as little as possible.
 */
const CONSOLE = {
  bg: '#111111',
  error: '#FF6B6B',
  label: '#AAAAAA',
  stack: '#DDDDDD',
  hint: '#888888',
} as const;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: CONSOLE.bg },
  content: { padding: 20, paddingTop: 60 },
  title: {
    color: CONSOLE.error,
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 16,
  },
  label: {
    color: CONSOLE.label,
    fontSize: 12,
    marginTop: 12,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  message: { color: colors.white, fontSize: 14, fontFamily: 'Sora_500Medium' },
  stack: { color: CONSOLE.stack, fontSize: 11, fontFamily: 'Sora_500Medium' },
  hint: { color: CONSOLE.hint, marginTop: 24, fontSize: 12, fontStyle: 'italic' },
});
