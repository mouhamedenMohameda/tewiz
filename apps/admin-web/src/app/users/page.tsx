/**
 * /users — admin user-management screen.
 *
 *   - List all users (paged, with search by phone/name and role filter).
 *   - Create a new user → backend returns the initial 8-char password.
 *   - Regenerate a password for any existing user.
 *
 * Every generated password is shown ONLY ONCE in a modal with two CTAs:
 *   - "Copier" — copies to clipboard
 *   - "Envoyer sur WhatsApp" — opens a pre-filled wa.me link
 *
 * After the modal closes, the password can never be retrieved.
 */

'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppShell } from '@/components/AppShell';
import { api } from '@/lib/api';

interface UserRow {
  id: string;
  phone: string;
  role: 'rider' | 'captain' | 'admin';
  status: 'active' | 'suspended' | 'banned' | 'deleted';
  full_name: string | null;
  language: 'fr' | 'ar' | 'en';
  has_password: boolean;
  must_reset_password: boolean;
  password_updated_at: string | null;
  last_seen_at: string | null;
  created_at: string;
}

interface ListResponse {
  users: UserRow[];
  total: number;
  limit: number;
  offset: number;
}

interface PasswordReveal {
  userId: string;
  phone: string;
  fullName: string;
  password: string;
  whatsappLink: string;
}

export default function UsersPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<UserRow['role'] | 'all'>('all');
  const [reveal, setReveal] = useState<PasswordReveal | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const list = useQuery<ListResponse>({
    queryKey: ['admin-users', search, roleFilter],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '100' });
      if (search.trim()) params.set('search', search.trim());
      if (roleFilter !== 'all') params.set('role', roleFilter);
      const r = await api.get(`/admin/users?${params.toString()}`);
      return r.data as ListResponse;
    },
  });

  const regenerate = useMutation({
    mutationFn: async (user: UserRow) => {
      const r = await api.post<PasswordReveal & { ok: boolean }>(
        `/admin/users/${user.id}/regenerate-password`,
      );
      return {
        userId: user.id,
        phone: user.phone,
        fullName: user.full_name ?? '',
        password: r.data.password,
        whatsappLink: r.data.whatsappLink,
      } as PasswordReveal;
    },
    onSuccess: (data) => {
      setReveal(data);
      qc.invalidateQueries({ queryKey: ['admin-users'] });
    },
  });

  return (
    <AppShell>
      <div className="p-6 max-w-7xl mx-auto">
        <div className="flex items-end justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 mb-1">Utilisateurs</h1>
            <p className="text-sm text-slate-500">
              {list.data ? `${list.data.total} comptes` : 'Chargement...'}
            </p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg font-medium text-sm"
          >
            + Créer un utilisateur
          </button>
        </div>

        {/* Filters */}
        <div className="flex gap-3 mb-4">
          <input
            type="search"
            placeholder="Rechercher par nom ou téléphone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm"
          />
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as 'rider' | 'captain' | 'admin' | 'all')}
            className="border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
          >
            <option value="all">Tous les rôles</option>
            <option value="rider">Riders</option>
            <option value="captain">Chauffeurs</option>
            <option value="admin">Admins</option>
          </select>
        </div>

        {list.isLoading && <div className="text-slate-500">Chargement...</div>}
        {list.error && <div className="text-red-600">Erreur de chargement.</div>}

        {list.data && (
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-slate-700">Nom</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-700">Téléphone</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-700">Rôle</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-700">Mot de passe</th>
                  <th className="px-4 py-3 text-left font-medium text-slate-700">Créé</th>
                  <th className="px-4 py-3 text-right font-medium text-slate-700">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {list.data.users.map((u) => (
                  <tr key={u.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium">{u.full_name ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600 font-mono">{u.phone}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-1 text-xs rounded-md font-medium ${roleBadge(u.role)}`}>
                        {u.role}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs">
                      {!u.has_password ? (
                        <span className="text-amber-600">Non défini</span>
                      ) : u.must_reset_password ? (
                        <span className="text-amber-600">À régénérer</span>
                      ) : (
                        <span className="text-emerald-600">
                          OK · {u.password_updated_at
                            ? new Date(u.password_updated_at).toLocaleDateString('fr-FR')
                            : ''}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">
                      {new Date(u.created_at).toLocaleDateString('fr-FR')}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={() => regenerate.mutate(u)}
                        disabled={regenerate.isPending}
                        className="text-xs text-emerald-700 hover:text-emerald-900 font-medium"
                      >
                        Régénérer
                      </button>
                    </td>
                  </tr>
                ))}
                {list.data.users.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-4 py-8 text-center text-slate-500 text-sm">
                      Aucun utilisateur ne correspond à ce filtre.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Modals */}
        {showCreate && (
          <CreateUserModal
            onClose={() => setShowCreate(false)}
            onCreated={(payload) => {
              setShowCreate(false);
              setReveal(payload);
              qc.invalidateQueries({ queryKey: ['admin-users'] });
            }}
          />
        )}
        {reveal && (
          <PasswordRevealModal payload={reveal} onClose={() => setReveal(null)} />
        )}
      </div>
    </AppShell>
  );
}

// ---------------------------------------------------------------------------

function roleBadge(role: UserRow['role']) {
  switch (role) {
    case 'admin':   return 'bg-purple-100 text-purple-700';
    case 'captain': return 'bg-blue-100 text-blue-700';
    case 'rider':   return 'bg-slate-100 text-slate-700';
  }
}

// ---------------------------------------------------------------------------
// Create user modal
// ---------------------------------------------------------------------------

function CreateUserModal({
  onClose, onCreated,
}: {
  onClose: () => void;
  onCreated: (p: PasswordReveal) => void;
}) {
  const [phone, setPhone] = useState('+222');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<'rider' | 'captain' | 'admin'>('rider');
  const [error, setError] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: async () => {
      setError(null);
      const r = await api.post<{
        user: { id: string; phone: string; role: string; fullName: string };
        password: string;
        whatsappLink: string;
      }>('/admin/users', { phone, role, fullName });
      return {
        userId: r.data.user.id,
        phone: r.data.user.phone,
        fullName: r.data.user.fullName,
        password: r.data.password,
        whatsappLink: r.data.whatsappLink,
      } as PasswordReveal;
    },
    onSuccess: onCreated,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => {
      const msg =
        e.response?.data?.error?.message ??
        e.response?.data?.error?.code ??
        'Erreur lors de la création.';
      setError(typeof msg === 'string' ? msg : 'Erreur lors de la création.');
    },
  });

  return (
    <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
        <h2 className="text-lg font-bold mb-1">Créer un utilisateur</h2>
        <p className="text-sm text-slate-500 mb-4">
          Le mot de passe sera affiché une seule fois après la création.
        </p>

        <div className="space-y-3">
          <div>
            <label className="block text-xs text-slate-600 mb-1">Nom complet</label>
            <input
              autoFocus
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Mohamed Salem"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-600 mb-1">Téléphone (+222…)</label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+22245XXXXXXX"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm font-mono"
            />
          </div>
          <div>
            <label className="block text-xs text-slate-600 mb-1">Rôle</label>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as 'rider' | 'captain' | 'admin')}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
            >
              <option value="rider">Rider (passager)</option>
              <option value="captain">Chauffeur</option>
              <option value="admin">Administrateur</option>
            </select>
          </div>
        </div>

        {error && (
          <div className="mt-3 text-sm text-red-600">{error}</div>
        )}

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg"
          >
            Annuler
          </button>
          <button
            onClick={() => submit.mutate()}
            disabled={submit.isPending || !fullName || phone.length < 11}
            className="px-4 py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg disabled:opacity-50"
          >
            {submit.isPending ? 'Création…' : 'Créer et générer le mot de passe'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Password reveal modal (shown once)
// ---------------------------------------------------------------------------

function PasswordRevealModal({
  payload, onClose,
}: {
  payload: PasswordReveal;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  function copyPwd() {
    navigator.clipboard.writeText(payload.password).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => undefined);
  }

  return (
    <div className="fixed inset-0 bg-slate-900/50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
        <h2 className="text-lg font-bold mb-1">Mot de passe généré</h2>
        <p className="text-sm text-slate-500 mb-4">
          Envoyez-le à <span className="font-mono">{payload.phone}</span>
          {payload.fullName ? ` (${payload.fullName})` : ''} sur WhatsApp.
          Ce mot de passe ne sera plus affiché.
        </p>

        <div className="bg-slate-100 border border-slate-200 rounded-lg p-4 text-center mb-4">
          <div className="font-mono text-2xl font-bold tracking-widest text-slate-900 select-all">
            {payload.password}
          </div>
        </div>

        <div className="flex gap-2">
          <button
            onClick={copyPwd}
            className="flex-1 px-3 py-2.5 text-sm font-medium bg-slate-200 hover:bg-slate-300 text-slate-900 rounded-lg"
          >
            {copied ? '✓ Copié' : 'Copier'}
          </button>
          <a
            href={payload.whatsappLink}
            target="_blank"
            rel="noreferrer"
            className="flex-1 px-3 py-2.5 text-sm font-medium bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-center"
          >
            Envoyer sur WhatsApp
          </a>
        </div>

        <button
          onClick={onClose}
          className="w-full mt-3 px-3 py-2 text-sm font-medium text-slate-600 hover:text-slate-900"
        >
          J'ai terminé
        </button>
      </div>
    </div>
  );
}
