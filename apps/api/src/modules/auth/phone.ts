import { z } from 'zod';

// Mauritania country code is +222 and mobile numbers are 8 digits starting with 2,3,4.
// We accept either:
//   +22245123456
//   22245123456
//   45123456
// and normalize to +222XXXXXXXX.
const E164_MR = /^\+222[234]\d{7}$/;

export const phoneSchema = z
  .string()
  .trim()
  .transform((raw) => {
    const digits = raw.replace(/\D/g, '');
    if (digits.length === 8 && /^[234]/.test(digits)) return `+222${digits}`;
    if (digits.length === 11 && digits.startsWith('222')) return `+${digits}`;
    return raw.startsWith('+') ? raw : `+${digits}`;
  })
  .refine((v) => E164_MR.test(v), {
    message: 'Numéro mauritanien invalide (attendu: +222 suivi de 8 chiffres)',
  });
