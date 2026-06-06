import { env } from '../../config/env.js';

export interface SmsSender {
  send(to: string, message: string): Promise<void>;
}

/**
 * In-memory buffer of recent mock SMSes (dev only).
 * Keyed by recipient phone, last 50 messages.
 */
const mockBuffer = new Map<string, { message: string; sentAt: Date }[]>();

export function getMockMessages(phone: string) {
  return mockBuffer.get(phone) ?? [];
}

/**
 * Dev sender: prints OTPs to console AND stores them in an in-memory buffer
 * so tests can fetch them via /dev/mock-sms?phone=...
 */
class MockSender implements SmsSender {
  async send(to: string, message: string): Promise<void> {
    console.log(`\n📲 [mock-sms] to=${to}\n   ${message}\n`);
    const arr = mockBuffer.get(to) ?? [];
    arr.push({ message, sentAt: new Date() });
    if (arr.length > 50) arr.shift();
    mockBuffer.set(to, arr);
  }
}

/**
 * Twilio sender placeholder. Wire up once you have credentials.
 * Twilio doesn't have great Mauritania delivery — we'll likely switch to a
 * Mauritel/Chinguitel gateway for production. Keep the interface stable.
 */
class TwilioSender implements SmsSender {
  async send(_to: string, _message: string): Promise<void> {
    throw new Error('TwilioSender not implemented yet — keep SMS_PROVIDER=mock for now');
  }
}

export const sms: SmsSender = env.SMS_PROVIDER === 'twilio' ? new TwilioSender() : new MockSender();
