import { Component, type ReactNode } from 'react';
import { ScrollView, Text, View, StyleSheet } from 'react-native';
import { saveCrash } from '@/lib/crash-reporter';

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
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <ScrollView
        style={styles.container}
        contentContainerStyle={styles.content}
      >
        <Text style={styles.title}>Crash JS au boot</Text>
        <Text style={styles.label}>Message</Text>
        <Text selectable style={styles.message}>
          {error.message}
        </Text>
        {error.stack ? (
          <>
            <Text style={styles.label}>Stack</Text>
            <Text selectable style={styles.stack}>
              {error.stack}
            </Text>
          </>
        ) : null}
        <Text style={styles.hint}>
          (Capture cet écran et envoie-le.)
        </Text>
      </ScrollView>
    );
  }
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#111' },
  content: { padding: 20, paddingTop: 60 },
  title: {
    color: '#ff6b6b',
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 16,
  },
  label: {
    color: '#aaa',
    fontSize: 12,
    marginTop: 12,
    marginBottom: 4,
    textTransform: 'uppercase',
  },
  message: { color: '#fff', fontSize: 14, fontFamily: 'monospace' },
  stack: { color: '#ddd', fontSize: 11, fontFamily: 'monospace' },
  hint: { color: '#888', marginTop: 24, fontSize: 12, fontStyle: 'italic' },
});
