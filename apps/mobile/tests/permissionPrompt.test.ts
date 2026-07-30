/**
 * Locks the one-time guided permission prompts that make the incoming-ride
 * alert behave like Uber:
 *   - ensureOverlayPermission     → Android "display over other apps" (superposition)
 *   - ensureFullScreenIntentPermission → Android 14+ full-screen intents
 *
 * The invariant "under all conditions": prompt exactly once, on the right
 * platform/version, never nag after it's been handled, but always honour force.
 *
 * Modules are re-imported per test (resetModules) so their module-level
 * "prompted this session" guard starts fresh each time; the mock spies live in
 * a hoisted bag so they survive the re-import.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
  alert: vi.fn(),
  openSettings: vi.fn(),
  storage: new Map<string, string>(),
  platform: { OS: 'android' as string, Version: 34 as number },
}));

vi.mock('react-native', () => ({
  Platform: h.platform,
  Alert: { alert: h.alert },
  Linking: { openSettings: h.openSettings },
}));
vi.mock('expo-application', () => ({ applicationId: 'com.tewiz.app' }));
vi.mock('../lib/i18n', () => ({ i18n: { t: (k: string) => k } }));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: async (k: string) => h.storage.get(k) ?? null,
    setItem: async (k: string, v: string) => { h.storage.set(k, v); },
    removeItem: async (k: string) => { h.storage.delete(k); },
  },
}));

beforeEach(() => {
  vi.resetModules();
  h.alert.mockClear();
  h.openSettings.mockClear();
  h.storage.clear();
  h.platform.OS = 'android';
  h.platform.Version = 34;
});

describe('ensureOverlayPermission', () => {
  async function run(opts?: { appName?: string; force?: boolean }) {
    const { ensureOverlayPermission } = await import('../lib/overlayPermission');
    await ensureOverlayPermission(opts);
  }

  it('prompts on Android when not yet handled', async () => {
    await run({ appName: 'Tewiz' });
    expect(h.alert).toHaveBeenCalledTimes(1);
  });

  it('does NOT prompt on iOS', async () => {
    h.platform.OS = 'ios';
    await run();
    expect(h.alert).not.toHaveBeenCalled();
  });

  it('does NOT prompt again once handled', async () => {
    h.storage.set('@tewiz/overlay-handled', '1');
    await run();
    expect(h.alert).not.toHaveBeenCalled();
  });

  it('still prompts when handled but force is set', async () => {
    h.storage.set('@tewiz/overlay-handled', '1');
    await run({ force: true });
    expect(h.alert).toHaveBeenCalledTimes(1);
  });

  it('guards against a double prompt within the same session', async () => {
    const { ensureOverlayPermission } = await import('../lib/overlayPermission');
    await ensureOverlayPermission();
    await ensureOverlayPermission();
    expect(h.alert).toHaveBeenCalledTimes(1);
  });
});

describe('ensureBatteryExemption', () => {
  async function run(opts?: { appName?: string; force?: boolean }) {
    const { ensureBatteryExemption } = await import('../lib/batteryExemption');
    await ensureBatteryExemption(opts);
  }

  it('prompts on Android when not yet handled', async () => {
    await run({ appName: 'Tewiz' });
    expect(h.alert).toHaveBeenCalledTimes(1);
  });

  it('does NOT prompt on iOS', async () => {
    h.platform.OS = 'ios';
    await run();
    expect(h.alert).not.toHaveBeenCalled();
  });

  it('does NOT prompt again once handled', async () => {
    h.storage.set('@tewiz/battery-exemption-handled', '1');
    await run();
    expect(h.alert).not.toHaveBeenCalled();
  });

  it('still prompts when handled but force is set', async () => {
    h.storage.set('@tewiz/battery-exemption-handled', '1');
    await run({ force: true });
    expect(h.alert).toHaveBeenCalledTimes(1);
  });

  it('guards against a double prompt within the same session', async () => {
    const { ensureBatteryExemption } = await import('../lib/batteryExemption');
    await ensureBatteryExemption();
    await ensureBatteryExemption();
    expect(h.alert).toHaveBeenCalledTimes(1);
  });
});

describe('ensureFullScreenIntentPermission', () => {
  async function run(opts?: { force?: boolean }) {
    const { ensureFullScreenIntentPermission } = await import('../lib/fullScreenIntentPermission');
    await ensureFullScreenIntentPermission(opts);
  }

  it('prompts on Android 14+ when not yet handled', async () => {
    await run();
    expect(h.alert).toHaveBeenCalledTimes(1);
  });

  it('does NOT prompt below Android 14', async () => {
    h.platform.Version = 33;
    await run();
    expect(h.alert).not.toHaveBeenCalled();
  });

  it('does NOT prompt on iOS', async () => {
    h.platform.OS = 'ios';
    await run();
    expect(h.alert).not.toHaveBeenCalled();
  });

  it('does NOT prompt again once handled', async () => {
    h.storage.set('@tewiz/fsi-handled', '1');
    await run();
    expect(h.alert).not.toHaveBeenCalled();
  });

  it('still prompts when handled but force is set', async () => {
    h.storage.set('@tewiz/fsi-handled', '1');
    await run({ force: true });
    expect(h.alert).toHaveBeenCalledTimes(1);
  });
});
