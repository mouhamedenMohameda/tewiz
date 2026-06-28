/**
 * Single source of truth for the admin-web brand name.
 *
 * 👉 To rebrand the back-office, change APP_NAME here.
 *    (Mirrors apps/mobile/brand.json — keep the two in sync on a rebrand.)
 *
 * Note: technical identifiers are intentionally NOT here and must stay stable:
 *   - the API domain (src/lib/env.ts)
 *   - the localStorage auth key (src/lib/auth.ts)
 */
export const APP_NAME = 'Aloo';
