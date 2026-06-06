'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/lib/auth';
import clsx from 'clsx';

const NAV = [
  { href: '/applications', label: 'Dossiers KYC', icon: '📋' },
  { href: '/topups',       label: 'Recharges',   icon: '💰' },
  { href: '/captains',     label: 'Chauffeurs',  icon: '🚕' },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const router = useRouter();
  const user = useAuth((s) => s.user);
  const hydrate = useAuth((s) => s.hydrate);
  const hydrated = useAuth((s) => s.hydrated);
  const clear = useAuth((s) => s.clear);

  useEffect(() => { hydrate(); }, [hydrate]);
  useEffect(() => {
    if (hydrated && (!user || user.role !== 'admin')) router.replace('/login');
  }, [hydrated, user, router]);

  if (!hydrated || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center text-slate-500">
        Chargement...
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-slate-50">
      {/* Sidebar */}
      <aside className="w-64 bg-white border-r border-slate-200 flex flex-col">
        <div className="px-6 py-5 border-b border-slate-200">
          <div className="text-xl font-bold text-brand-900">Tewiz</div>
          <div className="text-xs text-slate-500">Back-office</div>
        </div>

        <nav className="flex-1 p-3 space-y-1">
          {NAV.map((item) => {
            const active = path.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={clsx(
                  'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition',
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
            <div className="text-sm font-medium text-slate-900 mt-0.5">
              {user.fullName ?? user.phone}
            </div>
          </div>
          <button
            onClick={() => { clear(); router.replace('/login'); }}
            className="btn-ghost w-full mt-1 text-left text-red-600 hover:bg-red-50"
          >
            Déconnexion
          </button>
        </div>
      </aside>

      {/* Main */}
      <main className="flex-1 overflow-auto">{children}</main>
    </div>
  );
}
