'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { canAccessPath, defaultLandingFor, PAGE_PERMS } from '@/lib/permissions';
import { APP_NAME } from '@/lib/brand';
import clsx from 'clsx';

// Match the most specific registered path prefix — e.g. "/settings/documents"
// wins over "/settings" for /settings/documents/foo.
function resolvePermPath(pathname: string): string | null {
  const candidates = Object.keys(PAGE_PERMS)
    .filter((p) => pathname === p || pathname.startsWith(p + '/'))
    .sort((a, b) => b.length - a.length);
  return candidates[0] ?? null;
}

const NAV = [
  { href: '/applications',   label: 'Dossiers KYC', icon: '📋' },
  { href: '/topups',         label: 'Recharges',   icon: '💰' },
  { href: '/users',          label: 'Utilisateurs', icon: '👥' },
  { href: '/captains',       label: 'Chauffeurs',  icon: '🚕' },
  { href: '/voice-requests', label: 'Demandes vocales', icon: '🎙️' },
  { href: '/rides',          label: 'Courses',     icon: '🛣️' },
  { href: '/rides/new',      label: 'Nouvelle course', icon: '🗺️' },
  { href: '/restaurants',    label: 'Restaurants', icon: '🍽️' },
  { href: '/partners',       label: 'Partenaires', icon: '🤝' },
  { href: '/carpooling',     label: 'Covoiturage', icon: '🚗' },
  { href: '/listings',       label: 'Annonces',    icon: '📢' },
  { href: '/stats',          label: 'Statistiques', icon: '📊' },
  { href: '/notifications',  label: 'Notifications', icon: '🔔' },
  { href: '/settings',       label: 'Paramètres',  icon: '⚙️' },
  { href: '/settings/documents', label: 'Documents requis', icon: '📑' },
];

const ADMIN_ROLE_LABEL: Record<string, string> = {
  super_admin:  'Super admin',
  ops_manager:  'Manager opérations',
  dispatcher:   'Dispatcher',
  kyc_reviewer: 'Vérificateur KYC',
  finance:      'Finance',
  support:      'Support',
};

function Logo({ size = 38 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 1024 1024" aria-label="Aloo" className="shrink-0">
      <defs>
        <linearGradient id="aloLogoMark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#F6A623" />
          <stop offset="0.55" stopColor="#F2682C" />
          <stop offset="1" stopColor="#D9531B" />
        </linearGradient>
      </defs>
      <rect x="0" y="0" width="1024" height="1024" rx="232" fill="url(#aloLogoMark)" />
      <g fill="none" stroke="#FFFCF6" strokeWidth="86" strokeLinecap="round" strokeLinejoin="round">
        <path d="M300 760 L512 286" />
        <path d="M724 760 L512 286" />
        <path d="M388 596 L636 596" />
      </g>
    </svg>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const hydrate = useAuth((s) => s.hydrate);
  const hydrated = useAuth((s) => s.hydrated);
  const clear = useAuth((s) => s.clear);

  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => { hydrate(); }, [hydrate]);
  useEffect(() => {
    if (!hydrated) return;
    if (!user || user.role !== 'admin' || !user.adminRole) {
      router.replace('/login');
      return;
    }
    // Sub-role gate: bounce to a page they CAN see if they hit a forbidden URL.
    const permPath = resolvePermPath(path);
    if (permPath && !canAccessPath(user.adminRole, permPath)) {
      router.replace(defaultLandingFor(user.adminRole));
    }
  }, [hydrated, user, router, path]);

  // Close drawer on route change
  useEffect(() => { setDrawerOpen(false); }, [path]);

  // Lock body scroll when drawer is open on mobile
  useEffect(() => {
    if (drawerOpen) {
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = ''; };
    }
  }, [drawerOpen]);

  if (!hydrated || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500">
        Chargement...
      </div>
    );
  }

  // Don't render the forbidden page's content while the redirect is in flight.
  const permPath = resolvePermPath(path);
  const allowed = !permPath || canAccessPath(user.adminRole, permPath);

  const sidebarContent = (
    <>
      <div className="px-6 py-5 border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <Logo />
          <div>
            <div className="text-xl font-bold text-brand-900 leading-none">{APP_NAME}</div>
            <div className="text-xs text-slate-500 mt-0.5">Back-office</div>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setDrawerOpen(false)}
          className="lg:hidden -mr-2 p-2 rounded-lg text-slate-500 hover:bg-slate-100"
          aria-label="Fermer le menu"
        >
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <nav className="flex-1 p-3 space-y-1 overflow-y-auto">
        {NAV.filter((item) => canAccessPath(user.adminRole, item.href)).map((item) => {
          const active =
            path === item.href ||
            path.startsWith(item.href + '/');
          return (
            <Link
              key={item.href}
              href={item.href}
              className={clsx(
                'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition min-h-[44px]',
                active
                  ? 'bg-brand-50 text-brand-700 font-medium'
                  : 'text-slate-700 hover:bg-slate-100',
              )}
            >
              <span className="text-lg">{item.icon}</span>
              <span>{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="p-3 border-t border-slate-200">
        <div className="px-3 py-2 text-xs text-slate-500">
          Connecté en tant que
          <div className="text-sm font-medium text-slate-900 mt-0.5 truncate">
            {user.fullName ?? user.phone}
          </div>
          {user.adminRole && (
            <div className="text-xs text-brand-700 font-medium mt-0.5">
              {ADMIN_ROLE_LABEL[user.adminRole] ?? user.adminRole}
            </div>
          )}
        </div>
        <button
          onClick={() => { clear(); router.replace('/login'); }}
          className="btn-ghost w-full mt-1 text-left text-red-600 hover:bg-red-50"
        >
          Déconnexion
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-slate-50 lg:flex">
      {/* Mobile top bar */}
      <header className="lg:hidden sticky top-0 z-30 flex items-center justify-between bg-white border-b border-slate-200 px-4 h-14">
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="-ml-2 p-2 rounded-lg text-slate-700 hover:bg-slate-100"
          aria-label="Ouvrir le menu"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <div className="flex items-center gap-2">
          <Logo size={28} />
          <span className="text-lg font-bold text-brand-900">{APP_NAME}</span>
        </div>
        <div className="w-10" />
      </header>

      {/* Mobile drawer backdrop */}
      {drawerOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40 bg-slate-900/40"
          onClick={() => setDrawerOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Sidebar — drawer on mobile, fixed on desktop */}
      <aside
        className={clsx(
          'bg-white border-r border-slate-200 flex flex-col',
          // Mobile: off-canvas drawer
          'fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] transform transition-transform duration-200',
          drawerOpen ? 'translate-x-0' : '-translate-x-full',
          // Desktop: static sidebar
          'lg:static lg:translate-x-0 lg:w-64 lg:max-w-none lg:transition-none',
        )}
      >
        {sidebarContent}
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto min-w-0">
        {allowed ? children : (
          <div className="min-h-screen flex items-center justify-center text-slate-500">
            Redirection…
          </div>
        )}
      </main>
    </div>
  );
}
