'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import type { AdminRole } from '@tewiz/shared-types';
import { useAuth } from './auth';

// Per-path admin sub-roles allowed to OPEN the page. Matches the backend
// matrix in apps/api/src/modules/admin/admin.routes.ts — keep both in sync.
// super_admin always passes, listed explicitly for clarity.
export const PAGE_PERMS: Record<string, AdminRole[]> = {
  '/applications':       ['super_admin', 'ops_manager', 'dispatcher', 'kyc_reviewer', 'support'],
  '/topups':             ['super_admin', 'ops_manager', 'finance', 'support'],
  '/users':              ['super_admin', 'ops_manager'],
  '/captains':           ['super_admin', 'ops_manager', 'dispatcher', 'kyc_reviewer', 'finance', 'support'],
  '/voice-requests':     ['super_admin', 'ops_manager', 'dispatcher', 'support'],
  '/rides':              ['super_admin', 'ops_manager', 'dispatcher', 'finance', 'support'],
  '/rides/new':          ['super_admin', 'ops_manager', 'dispatcher'],
  '/restaurants':        ['super_admin', 'ops_manager', 'dispatcher', 'kyc_reviewer', 'support'],
  '/partners':             ['super_admin', 'ops_manager', 'finance', 'support'],
  '/partners/settlements': ['super_admin', 'ops_manager', 'finance', 'support'],
  '/partners/fraud':       ['super_admin', 'ops_manager', 'finance', 'support'],
  '/carpooling':         ['super_admin', 'ops_manager', 'dispatcher', 'finance', 'support'],
  '/stats':              ['super_admin', 'ops_manager', 'dispatcher'],
  '/notifications':      ['super_admin', 'ops_manager'],
  '/settings':           ['super_admin'],
  '/settings/documents': ['super_admin', 'kyc_reviewer'],
  '/app-release':        ['super_admin'],
};

export function canAccessPath(adminRole: AdminRole | null, path: string): boolean {
  if (!adminRole) return false;
  const allowed = PAGE_PERMS[path];
  if (!allowed) return true; // Unlisted paths are open to any admin.
  return allowed.includes(adminRole);
}

// Pick the first page the user can access. Used to redirect away from a
// forbidden landing page (e.g. finance shouldn't land on /applications).
export function defaultLandingFor(adminRole: AdminRole | null): string {
  if (!adminRole) return '/login';
  const priority = [
    '/applications',
    '/rides',
    '/topups',
    '/voice-requests',
    '/restaurants',
    '/carpooling',
    '/stats',
    '/users',
    '/notifications',
    '/settings',
  ];
  for (const p of priority) {
    if (canAccessPath(adminRole, p)) return p;
  }
  return '/login';
}

/**
 * Page-level guard. Call at the top of a page component — redirects to a
 * landing page the user can access if their role isn't on the allow list.
 */
export function useRequireAdminRole(...allowed: AdminRole[]): {
  ready: boolean;
  adminRole: AdminRole | null;
} {
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const hydrated = useAuth((s) => s.hydrated);
  const adminRole = user?.adminRole ?? null;

  useEffect(() => {
    if (!hydrated) return;
    if (!user || user.role !== 'admin' || !adminRole) {
      router.replace('/login');
      return;
    }
    if (adminRole === 'super_admin') return;
    if (allowed.length > 0 && !allowed.includes(adminRole)) {
      router.replace(defaultLandingFor(adminRole));
    }
    // We intentionally exclude `allowed` from deps — it's a stable list per
    // call site and re-checking it on every render would just thrash.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, user, adminRole, router]);

  const ready =
    hydrated &&
    !!user &&
    user.role === 'admin' &&
    !!adminRole &&
    (adminRole === 'super_admin' || allowed.length === 0 || allowed.includes(adminRole));

  return { ready, adminRole };
}

// Ergonomic helper for hiding buttons / sections inside a page.
export function useCan(...allowed: AdminRole[]): boolean {
  const adminRole = useAuth((s) => s.user?.adminRole ?? null);
  if (!adminRole) return false;
  if (adminRole === 'super_admin') return true;
  return allowed.includes(adminRole);
}
