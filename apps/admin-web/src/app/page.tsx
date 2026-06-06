'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';

export default function Home() {
  const router = useRouter();
  const hydrate = useAuth((s) => s.hydrate);
  const hydrated = useAuth((s) => s.hydrated);
  const user = useAuth((s) => s.user);

  useEffect(() => { hydrate(); }, [hydrate]);
  useEffect(() => {
    if (!hydrated) return;
    router.replace(user?.role === 'admin' ? '/applications' : '/login');
  }, [hydrated, user, router]);

  return (
    <div className="min-h-screen flex items-center justify-center text-slate-500">
      Chargement...
    </div>
  );
}
