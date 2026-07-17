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
import { ResponsiveTable, type Column } from '@/components/ResponsiveTable';
import { api } from '@/lib/api';
import { useCan } from '@/lib/permissions';
import { ADMIN_ROLES, type AdminRole } from '@tewiz/shared-types';

const ADMIN_ROLE_LABEL: Record<AdminRole, string> = {
  super_admin:  'Super admin',
  ops_manager:  'Manager opérations',
  dispatcher:   'Dispatcher',
  kyc_reviewer: 'Vérificateur KYC',
  finance:      'Finance',
  support:      'Support',
};

interface UserRow {
  id: string;
  phone: string;
  role: 'rider' | 'captain' | 'admin';
  admin_role: AdminRole | null;
  status: 'active' | 'suspended' | 'banned' | 'deleted';
  full_name: string | null;
  language: 'fr' | 'ar' | 'en';
  has_password: boolean;
  must_reset_password: boolean;
  password_updated_at: string | null;
  last_seen_at: string | null;
  online: boolean;
  created_at: string;
}

interface ListResponse {
  users: UserRow[];
  total: number;
  onlineCount: number;
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
  const isSuperAdmin = useCan(); // super_admin only — useCan() with no args
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<UserRow['role'] | 'all'>('all');
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [reveal, setReveal] = useState<PasswordReveal | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [editingRole, setEditingRole] = useState<UserRow | null>(null);
  const [confirmAction, setConfirmAction] = useState<
    { user: UserRow; action: 'suspend' | 'reactivate' | 'delete' } | null
  >(null);

  // Anyone on this page is at least ops_manager. Actions targeting another
  // admin are super_admin only — mirror the backend guard so the buttons
  // don't offer something the API will reject.
  const canManage = (u: UserRow) => u.role !== 'admin' || isSuperAdmin;

  const list = useQuery<ListResponse>({
    queryKey: ['admin-users', search, roleFilter, onlineOnly],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '100' });
      if (search.trim()) params.set('search', search.trim());
      if (roleFilter !== 'all') params.set('role', roleFilter);
      if (onlineOnly) params.set('online', 'true');
      const r = await api.get(`/admin/users?${params.toString()}`);
      return r.data as ListResponse;
    },
    refetchInterval: 15_000,
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

  const columns: Column<UserRow>[] = [
    {
      key: 'name',
      header: 'Nom',
      mobilePrimary: true,
      cell: (u) => (
        <div className="flex items-center gap-2 font-medium">
          <span
            title={
              u.online
                ? 'En ligne (vu < 5 min)'
                : u.last_seen_at
                ? `Vu ${formatLastSeen(u.last_seen_at)}`
                : 'Jamais connecté'
            }
            className={`w-2 h-2 rounded-full shrink-0 ${
              u.online ? 'bg-emerald-500 ring-2 ring-emerald-100' : 'bg-slate-300'
            }`}
          />
          <span className={u.status !== 'active' ? 'text-slate-400 line-through' : ''}>
            {u.full_name ?? '—'}
          </span>
          {u.status !== 'active' && (
            <span className="px-1.5 py-0.5 text-[10px] rounded font-semibold bg-amber-100 text-amber-700 uppercase tracking-wide">
              {u.status === 'banned' ? 'Banni' : 'Suspendu'}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'phone',
      header: 'Téléphone',
      cell: (u) => <span className="text-slate-600 font-mono">{u.phone}</span>,
    },
    {
      key: 'role',
      header: 'Rôle',
      cell: (u) => (
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`px-2 py-1 text-xs rounded-md font-medium ${roleBadge(u.role)}`}>
            {u.role}
          </span>
          {u.admin_role && (
            <span className="px-2 py-1 text-xs rounded-md font-medium bg-purple-50 text-purple-700 border border-purple-200">
              {ADMIN_ROLE_LABEL[u.admin_role]}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'password',
      header: 'Mot de passe',
      mobileLabel: 'M.d.p.',
      cell: (u) => (
        <span className="text-xs">
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
        </span>
      ),
    },
    {
      key: 'created',
      header: 'Créé',
      cell: (u) => (
        <span className="text-slate-500 text-xs">
          {new Date(u.created_at).toLocaleDateString('fr-FR')}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      hideOnMobile: true,
      cell: (u) => (
        <div className="flex items-center justify-end gap-3">
          {isSuperAdmin && u.role === 'admin' && (
            <button
              onClick={() => setEditingRole(u)}
              className="text-xs text-purple-700 hover:text-purple-900 font-medium"
            >
              Rôle admin
            </button>
          )}
          <button
            onClick={() => regenerate.mutate(u)}
            disabled={regenerate.isPending}
            className="text-xs text-emerald-700 hover:text-emerald-900 font-medium"
          >
            Régénérer
          </button>
          {canManage(u) && (
            u.status === 'active' ? (
              <button
                onClick={() => setConfirmAction({ user: u, action: 'suspend' })}
                className="text-xs text-amber-700 hover:text-amber-900 font-medium"
              >
                Suspendre
              </button>
            ) : (
              <button
                onClick={() => setConfirmAction({ user: u, action: 'reactivate' })}
                className="text-xs text-emerald-700 hover:text-emerald-900 font-medium"
              >
                Réactiver
              </button>
            )
          )}
          {canManage(u) && (
            <button
              onClick={() => setConfirmAction({ user: u, action: 'delete' })}
              className="text-xs text-red-600 hover:text-red-800 font-medium"
            >
              Supprimer
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <AppShell>
      <div className="p-4 md:p-6 max-w-7xl mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-6">
          <div>
            <h1 className="text-2xl font-bold text-slate-900 mb-1">Utilisateurs</h1>
            <p className="text-sm text-slate-500">
              {list.data ? (
                <>
                  {list.data.total} comptes ·{' '}
                  <span className="inline-flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                    {list.data.onlineCount} en ligne
                  </span>
                </>
              ) : (
                'Chargement...'
              )}
            </p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-lg font-medium text-sm w-full sm:w-auto"
          >
            + Créer un utilisateur
          </button>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 mb-4">
          <input
            type="search"
            placeholder="Rechercher par nom ou téléphone…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm"
          />
          <div className="flex gap-2 sm:gap-3">
            <select
              value={roleFilter}
              onChange={(e) => setRoleFilter(e.target.value as 'rider' | 'captain' | 'admin' | 'all')}
              className="flex-1 sm:flex-none border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
            >
              <option value="all">Tous les rôles</option>
              <option value="rider">Riders</option>
              <option value="captain">Captains</option>
              <option value="admin">Admins</option>
            </select>
            <button
              type="button"
              onClick={() => setOnlineOnly((v) => !v)}
              className={`px-3 py-2 text-sm rounded-lg border transition flex items-center gap-2 whitespace-nowrap ${
                onlineOnly
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-800'
                  : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${onlineOnly ? 'bg-emerald-500' : 'bg-slate-300'}`} />
              <span className="hidden sm:inline">En ligne uniquement</span>
              <span className="sm:hidden">En ligne</span>
            </button>
          </div>
        </div>

        {list.isLoading && <div className="text-slate-500">Chargement...</div>}
        {list.error && <div className="text-red-600">Erreur de chargement.</div>}

        {list.data && (
          <ResponsiveTable
            data={list.data.users}
            columns={columns}
            rowKey={(u) => u.id}
            emptyMessage="Aucun utilisateur ne correspond à ce filtre."
            mobileActions={(u) => (
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => regenerate.mutate(u)}
                  disabled={regenerate.isPending}
                  className="text-xs text-emerald-700 hover:text-emerald-900 font-medium px-3 py-1.5 bg-emerald-50 rounded-md"
                >
                  Régénérer le mot de passe
                </button>
                {canManage(u) && (
                  u.status === 'active' ? (
                    <button
                      onClick={() => setConfirmAction({ user: u, action: 'suspend' })}
                      className="text-xs text-amber-700 hover:text-amber-900 font-medium px-3 py-1.5 bg-amber-50 rounded-md"
                    >
                      Suspendre
                    </button>
                  ) : (
                    <button
                      onClick={() => setConfirmAction({ user: u, action: 'reactivate' })}
                      className="text-xs text-emerald-700 hover:text-emerald-900 font-medium px-3 py-1.5 bg-emerald-50 rounded-md"
                    >
                      Réactiver
                    </button>
                  )
                )}
                {canManage(u) && (
                  <button
                    onClick={() => setConfirmAction({ user: u, action: 'delete' })}
                    className="text-xs text-red-600 hover:text-red-800 font-medium px-3 py-1.5 bg-red-50 rounded-md"
                  >
                    Supprimer
                  </button>
                )}
              </div>
            )}
          />
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
        {editingRole && (
          <EditAdminRoleModal
            user={editingRole}
            onClose={() => setEditingRole(null)}
            onSaved={() => {
              setEditingRole(null);
              qc.invalidateQueries({ queryKey: ['admin-users'] });
            }}
          />
        )}
        {confirmAction && (
          <UserActionModal
            user={confirmAction.user}
            action={confirmAction.action}
            onClose={() => setConfirmAction(null)}
            onDone={() => {
              setConfirmAction(null);
              qc.invalidateQueries({ queryKey: ['admin-users'] });
            }}
          />
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

function formatLastSeen(iso: string): string {
  const d = new Date(iso);
  const min = Math.floor((Date.now() - d.getTime()) / 60_000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  return `le ${d.toLocaleDateString('fr-FR')}`;
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
  const isSuperAdmin = useCan();
  const [phone, setPhone] = useState('+222');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<'rider' | 'captain' | 'admin'>('rider');
  const [adminRole, setAdminRole] = useState<AdminRole>('support');
  const [error, setError] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: async () => {
      setError(null);
      const r = await api.post<{
        user: { id: string; phone: string; role: string; fullName: string };
        password: string;
        whatsappLink: string;
      }>('/admin/users', {
        phone,
        role,
        fullName,
        ...(role === 'admin' ? { adminRole } : {}),
      });
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
              <option value="rider">Rider (Client)</option>
              <option value="captain">Captain</option>
              {isSuperAdmin && (
                <option value="admin">Administrateur</option>
              )}
            </select>
          </div>
          {role === 'admin' && (
            <div>
              <label className="block text-xs text-slate-600 mb-1">Sous-rôle admin</label>
              <select
                value={adminRole}
                onChange={(e) => setAdminRole(e.target.value as AdminRole)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
              >
                {ADMIN_ROLES.map((r) => (
                  <option key={r} value={r}>{ADMIN_ROLE_LABEL[r]}</option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-500">
                Détermine les pages et actions accessibles dans l'admin.
              </p>
            </div>
          )}
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
// Edit admin sub-role (super_admin only)
// ---------------------------------------------------------------------------

function EditAdminRoleModal({
  user, onClose, onSaved,
}: {
  user: UserRow;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [adminRole, setAdminRole] = useState<AdminRole>(user.admin_role ?? 'support');
  const [error, setError] = useState<string | null>(null);

  const save = useMutation({
    mutationFn: async () => {
      setError(null);
      await api.patch(`/admin/users/${user.id}/admin-role`, { adminRole });
    },
    onSuccess: onSaved,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => {
      const code = e.response?.data?.error?.code;
      const msg = e.response?.data?.error?.message;
      if (code === 'last_super_admin') {
        setError('Impossible de retirer le dernier super_admin actif.');
      } else {
        setError(msg ?? 'Erreur lors de la mise à jour du rôle.');
      }
    },
  });

  const unchanged = adminRole === user.admin_role;

  return (
    <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
        <h2 className="text-lg font-bold mb-1">Changer le rôle admin</h2>
        <p className="text-sm text-slate-500 mb-4">
          {user.full_name ?? user.phone} — actuellement {user.admin_role
            ? ADMIN_ROLE_LABEL[user.admin_role]
            : 'sans rôle'}.
        </p>

        <select
          value={adminRole}
          onChange={(e) => setAdminRole(e.target.value as AdminRole)}
          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
        >
          {ADMIN_ROLES.map((r) => (
            <option key={r} value={r}>{ADMIN_ROLE_LABEL[r]}</option>
          ))}
        </select>

        {error && <div className="mt-3 text-sm text-red-600">{error}</div>}

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg"
          >
            Annuler
          </button>
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending || unchanged}
            className="px-4 py-2 text-sm font-medium bg-purple-600 hover:bg-purple-700 text-white rounded-lg disabled:opacity-50"
          >
            {save.isPending ? 'Enregistrement…' : 'Enregistrer'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Suspend / reactivate / delete confirmation
// ---------------------------------------------------------------------------

const ACTION_CONFIG = {
  suspend: {
    title: 'Suspendre le compte',
    body: "L'utilisateur sera immédiatement déconnecté et ne pourra plus se connecter tant que le compte reste suspendu. C'est réversible.",
    confirm: 'Suspendre',
    danger: false,
  },
  reactivate: {
    title: 'Réactiver le compte',
    body: "L'utilisateur pourra de nouveau se connecter avec son mot de passe existant.",
    confirm: 'Réactiver',
    danger: false,
  },
  delete: {
    title: 'Supprimer le compte',
    body: "Le compte sera supprimé : numéro et nom effacés, sessions révoquées, notifications coupées. Le numéro pourra être réutilisé. Cette action est irréversible.",
    confirm: 'Supprimer définitivement',
    danger: true,
  },
} as const;

function UserActionModal({
  user, action, onClose, onDone,
}: {
  user: UserRow;
  action: 'suspend' | 'reactivate' | 'delete';
  onClose: () => void;
  onDone: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const cfg = ACTION_CONFIG[action];

  const run = useMutation({
    mutationFn: async () => {
      setError(null);
      if (action === 'delete') {
        await api.delete(`/admin/users/${user.id}`);
      } else {
        await api.patch(`/admin/users/${user.id}/status`, {
          status: action === 'suspend' ? 'suspended' : 'active',
        });
      }
    },
    onSuccess: onDone,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => {
      const code = e.response?.data?.error?.code;
      const msg = e.response?.data?.error?.message;
      if (code === 'last_super_admin') {
        setError('Impossible : ce compte est le dernier super_admin actif.');
      } else if (code === 'cannot_target_self') {
        setError('Vous ne pouvez pas effectuer cette action sur votre propre compte.');
      } else {
        setError(msg ?? "Erreur lors de l'opération.");
      }
    },
  });

  return (
    <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
        <h2 className="text-lg font-bold mb-1">{cfg.title}</h2>
        <p className="text-sm text-slate-500 mb-2">
          {user.full_name ?? user.phone}
          {user.full_name ? ` · ${user.phone}` : ''}
        </p>
        <p className={`text-sm mb-4 ${cfg.danger ? 'text-red-700' : 'text-slate-600'}`}>
          {cfg.body}
        </p>

        {error && <div className="mb-3 text-sm text-red-600">{error}</div>}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-100 rounded-lg"
          >
            Annuler
          </button>
          <button
            onClick={() => run.mutate()}
            disabled={run.isPending}
            className={`px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-50 ${
              cfg.danger
                ? 'bg-red-600 hover:bg-red-700'
                : action === 'suspend'
                ? 'bg-amber-600 hover:bg-amber-700'
                : 'bg-emerald-600 hover:bg-emerald-700'
            }`}
          >
            {run.isPending ? '…' : cfg.confirm}
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
