/**
 * Shared harness for the red list.
 *
 * The push specs deliberately do NOT mock the push module. They mock the two
 * things underneath it — the database (for token lookups) and `fetch` (Expo's
 * HTTP endpoint) — and then assert that a request carrying the right token
 * reached Expo.
 *
 * That is what makes these specs implementation-agnostic: whatever you name the
 * function, whatever module you put it in, whether you batch it with other
 * notifications — a push to a rider ends up as an HTTP POST to exp.host with
 * their token in `to`. Assert the outcome, leave the design to the implementer.
 */
import { expect, vi } from 'vitest';

export const EXPO_URL = 'https://exp.host/--/api/v2/push/send';

export interface PushCapture {
  fetchMock: ReturnType<typeof vi.fn>;
  /** Every message body POSTed to Expo, decoded. */
  messages: () => any[];
  /** Every push token addressed across all requests. */
  recipients: () => string[];
}

/** Installs a `fetch` spy that answers like Expo does on success. */
export function capturePush(): PushCapture {
  const fetchMock = vi.fn(async (_url: string, init: any) => {
    const body = JSON.parse(init.body);
    const n = Array.isArray(body.to) ? body.to.length : 1;
    return {
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ data: Array.from({ length: n }, () => ({ status: 'ok' })) }),
    };
  });
  vi.stubGlobal('fetch', fetchMock);

  const messages = () =>
    fetchMock.mock.calls
      .filter(([url]) => String(url).includes('exp.host'))
      .map(([, init]: any[]) => JSON.parse(init.body));

  return {
    fetchMock,
    messages,
    recipients: () =>
      messages().flatMap((m) => (Array.isArray(m.to) ? m.to : [m.to])),
  };
}

/**
 * Asserts a push reached the given token, with a failure message that names the
 * feature rather than the mock. Vitest prints the message on failure, so the
 * red list reads as a to-do list.
 */
export function expectPushedTo(
  capture: PushCapture,
  token: string,
  what: string,
): void {
  expect(
    capture.recipients(),
    `No push reached ${token}. ${what}`,
  ).toContain(token);
}

/** Lets fire-and-forget `void promise` work settle before assertions run. */
export const flush = () =>
  new Promise((resolve) => setTimeout(resolve, 0));
