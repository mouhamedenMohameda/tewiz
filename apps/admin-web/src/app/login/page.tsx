'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function LoginPage() {
  const router = useRouter();
  const setSession = useAuth((s) => s.setSession);
  const user = useAuth((s) => s.user);
  const hydrate = useAuth((s) => s.hydrate);
  const hydrated = useAuth((s) => s.hydrated);

  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('+22245999999');
  const [code, setCode] = useState('');
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => { hydrate(); }, [hydrate]);
  useEffect(() => {
    if (hydrated && user?.role === 'admin') router.replace('/applications');
  }, [hydrated, user, router]);

  async function requestOtp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const r = await api.post('/auth/otp/request', { phone });
      if (r.data._devCode) setDevCode(r.data._devCode);
      setStep('code');
    } catch (e: any) {
      setErr(e.response?.data?.error?.message ?? 'Erreur réseau');
    } finally {
      setBusy(false);
    }
  }

  async function verifyOtp(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      const r = await api.post('/auth/otp/verify', {
        phone,
        code,
        role: 'admin',
        deviceId: 'tewiz-admin-web-' + window.crypto.randomUUID().slice(0, 8),
      });
      setSession({
        user: r.data.user,
        accessToken: r.data.tokens.accessToken,
        refreshToken: r.data.tokens.refreshToken,
      });
      router.replace('/applications');
    } catch (e: any) {
      const code = e.response?.data?.error?.code;
      if (code === 'role_mismatch') {
        setErr("Ce numéro n'est pas administrateur. Demande à un admin existant de te promouvoir.");
      } else {
        setErr(e.response?.data?.error?.message ?? 'Erreur réseau');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-4">
      <div className="card w-full max-w-md p-8">
        <div className="mb-8 text-center">
          <h1 className="text-2xl font-semibold text-slate-900">Tewiz Admin</h1>
          <p className="text-sm text-slate-500 mt-1">Connexion par téléphone</p>
        </div>

        {step === 'phone' && (
          <form onSubmit={requestOtp} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Numéro de téléphone
              </label>
              <input
                type="tel" required value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+222..."
                className="input"
              />
            </div>
            {err && <p className="text-sm text-red-600">{err}</p>}
            <button type="submit" disabled={busy} className="btn-primary w-full">
              {busy ? 'Envoi...' : 'Recevoir le code'}
            </button>
          </form>
        )}

        {step === 'code' && (
          <form onSubmit={verifyOtp} className="space-y-4">
            {devCode && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm">
                <span className="font-semibold">Code dev:</span>{' '}
                <code className="text-yellow-900">{devCode}</code>
                <p className="text-xs text-yellow-700 mt-1">
                  (Visible uniquement en mode développement.)
                </p>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Code à 6 chiffres
              </label>
              <input
                type="text" required value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric" pattern="[0-9]{6}"
                placeholder="123456"
                className="input text-center text-xl tracking-widest"
                autoFocus
              />
            </div>
            {err && <p className="text-sm text-red-600">{err}</p>}
            <div className="flex gap-2">
              <button
                type="button" onClick={() => { setStep('phone'); setCode(''); setDevCode(null); }}
                className="btn-secondary"
              >Retour</button>
              <button type="submit" disabled={busy || code.length !== 6} className="btn-primary flex-1">
                {busy ? 'Vérification...' : 'Se connecter'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
