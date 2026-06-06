import crypto from 'node:crypto';

// 32-char alphabet: A-Z without I,O + 2-9 (excludes I, O, 0, 1 to avoid confusion).
// 32^6 = 1,073,741,824 possible codes — collisions are vanishingly rare.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/**
 * Generate a 6-character reference code, e.g. "7F3A2B".
 * Caller must handle the unique-constraint collision and retry.
 */
export function generateReferenceCode(): string {
  let out = '';
  for (let i = 0; i < 6; i++) {
    out += ALPHABET[crypto.randomInt(0, ALPHABET.length)];
  }
  return out;
}
