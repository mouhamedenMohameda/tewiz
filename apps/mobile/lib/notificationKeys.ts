/**
 * React Query keys for the notification endpoints.
 *
 * They live in their own module because TWO components read them and one of
 * them writes the other's: the inbox screen marks items read and has to
 * invalidate the bell's unread count, which is a separate query with its own
 * 60 s poll. Keeping the keys as string literals in each file is how that
 * link silently breaks — a typo doesn't fail, it just stops invalidating, and
 * the badge goes stale for a minute with nothing to show for it.
 */

/** Full inbox — `GET /notifications`. Read by app/(app)/notifications.tsx. */
export const INBOX_KEY = ['notifications', 'inbox'] as const;

/**
 * Unread badge count — `GET /notifications?limit=1`. Read by
 * components/NotificationsBellButton.tsx, which renders on several screens and
 * shares this one cache entry between all of them.
 */
export const UNREAD_KEY = ['notifications', 'unread'] as const;
