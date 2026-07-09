/**
 * /notifications — admin compose + history.
 *
 * Send: pick a target (all captains / a group / a specific user) + title + body.
 *       The backend fans out one notification row per recipient AND fires
 *       Expo push for live alerts.
 *
 * History: every past send (one row per "campaign") with read-rate.
 */

'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppShell } from '@/components/AppShell';
import { api } from '@/lib/api';

type TargetType = 'all_captains' | 'all_riders' | 'all_users' | 'group' | 'user';
type GroupKey = 'active_captains' | 'bonus_active';

const TARGET_LABELS: Record<TargetType, string> = {
  all_users:    'Tous les utilisateurs',
  all_captains: 'Tous les chauffeurs',
  all_riders:   'Tous les passagers',
  group:        'Un groupe',
  user:         'Un utilisateur précis',
};

const TARGET_ORDER: TargetType[] = ['all_users', 'all_captains', 'all_riders', 'group', 'user'];

interface UserRow {
  id: string;
  phone: string;
  role: 'rider' | 'captain' | 'admin';
  full_name: string | null;
}

interface Campaign {
  id: string;
  targetType: string;
  targetValue: string | null;
  type: string;
  title: string;
  body: string;
  recipientCount: number;
  readCount: number;
  sentBy: string | null;
  createdAt: string;
  updatedAt: string | null;
}

const GROUP_LABELS: Record<GroupKey, string> = {
  active_captains: 'Chauffeurs actifs (en ligne ou vus < 7 j)',
  bonus_active:    'Chauffeurs avec bonus en cours',
};

export default function NotificationsPage() {
  const qc = useQueryClient();

  const [targetType, setTargetType] = useState<TargetType>('all_captains');
  const [group, setGroup] = useState<GroupKey>('active_captains');
  const [userSearch, setUserSearch] = useState('');
  const [selectedUser, setSelectedUser] = useState<UserRow | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [sentAt, setSentAt] = useState<number | null>(null);

  // Edit-in-place state for an existing campaign.
  const [editing, setEditing] = useState<Campaign | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editBody, setEditBody] = useState('');
  const [editError, setEditError] = useState<string | null>(null);

  const campaigns = useQuery<Campaign[]>({
    queryKey: ['admin-notifications'],
    queryFn: async () => {
      const r = await api.get<Campaign[]>('/admin/notifications?limit=50');
      return r.data;
    },
  });

  const userLookup = useQuery({
    queryKey: ['admin-users-search', userSearch],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '10', search: userSearch.trim() });
      const r = await api.get(`/admin/users?${params.toString()}`);
      return (r.data?.users ?? []) as UserRow[];
    },
    enabled: targetType === 'user' && userSearch.trim().length >= 2,
  });

  const send = useMutation({
    mutationFn: async () => {
      setError(null);
      const target =
        targetType === 'all_captains' ? { type: 'all_captains' as const } :
        targetType === 'all_riders'   ? { type: 'all_riders' as const } :
        targetType === 'all_users'    ? { type: 'all_users' as const } :
        targetType === 'group'        ? { type: 'group' as const, group } :
                                         { type: 'user' as const, userId: selectedUser!.id };
      const r = await api.post<{ campaignId: string; recipientCount: number }>(
        '/admin/notifications',
        { target, title: title.trim(), body: body.trim() },
      );
      return r.data;
    },
    onSuccess: () => {
      setSentAt(Date.now());
      setTitle('');
      setBody('');
      setSelectedUser(null);
      setUserSearch('');
      qc.invalidateQueries({ queryKey: ['admin-notifications'] });
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => {
      const msg =
        e.response?.data?.error?.message ??
        e.response?.data?.error?.code ??
        'Erreur lors de l’envoi.';
      setError(typeof msg === 'string' ? msg : 'Erreur lors de l’envoi.');
    },
  });

  const edit = useMutation({
    mutationFn: async () => {
      setEditError(null);
      const r = await api.patch<{ ok: true }>(
        `/admin/notifications/${editing!.id}`,
        { title: editTitle.trim(), body: editBody.trim() },
      );
      return r.data;
    },
    onSuccess: () => {
      setEditing(null);
      qc.invalidateQueries({ queryKey: ['admin-notifications'] });
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onError: (e: any) => {
      const msg =
        e.response?.data?.error?.message ??
        e.response?.data?.error?.code ??
        'Erreur lors de la modification.';
      setEditError(typeof msg === 'string' ? msg : 'Erreur lors de la modification.');
    },
  });

  const del = useMutation({
    mutationFn: async (id: string) => {
      const r = await api.delete<{ ok: true }>(`/admin/notifications/${id}`);
      return r.data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['admin-notifications'] });
    },
  });

  const startEdit = (c: Campaign) => {
    setEditing(c);
    setEditTitle(c.title);
    setEditBody(c.body);
    setEditError(null);
  };

  const confirmDelete = (c: Campaign) => {
    if (window.confirm(
      `Supprimer cette notification « ${c.title} » ?\n\nElle disparaîtra de la boîte de réception de tous les destinataires (${c.recipientCount}).`,
    )) {
      del.mutate(c.id);
    }
  };

  const canEdit = editTitle.trim().length >= 1 && editBody.trim().length >= 1;

  const canSend =
    title.trim().length >= 1 &&
    body.trim().length >= 1 &&
    (targetType !== 'user' || !!selectedUser);

  return (
    <AppShell>
      <div className="p-6 max-w-4xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold text-slate-900 mb-1">Notifications</h1>
          <p className="text-sm text-slate-500">
            Envoie une notification push + inbox à un utilisateur, un groupe, aux
            chauffeurs, aux passagers, ou à tout le monde. Une notification déjà
            envoyée peut être modifiée ou supprimée à distance depuis l’historique.
          </p>
        </div>

        <section className="card p-5 mb-6">
          <h2 className="font-semibold text-slate-900 mb-3">Nouvelle notification</h2>

          <div className="mb-4">
            <span className="block text-xs text-slate-600 mb-2">Destinataire</span>
            <div className="flex flex-wrap gap-2">
              {TARGET_ORDER.map((t) => (
                <button
                  key={t}
                  onClick={() => setTargetType(t)}
                  className={`px-3 py-1.5 text-sm rounded-lg border ${
                    targetType === t
                      ? 'bg-brand-50 border-brand-300 text-brand-700 font-medium'
                      : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {TARGET_LABELS[t]}
                </button>
              ))}
            </div>
          </div>

          {targetType === 'group' && (
            <div className="mb-4">
              <span className="block text-xs text-slate-600 mb-1">Groupe</span>
              <select
                value={group}
                onChange={(e) => setGroup(e.target.value as GroupKey)}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
              >
                {(Object.keys(GROUP_LABELS) as GroupKey[]).map((g) => (
                  <option key={g} value={g}>{GROUP_LABELS[g]}</option>
                ))}
              </select>
            </div>
          )}

          {targetType === 'user' && (
            <div className="mb-4">
              <span className="block text-xs text-slate-600 mb-1">Chercher un utilisateur (nom ou téléphone)</span>
              {selectedUser ? (
                <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                  <div className="text-sm">
                    <div className="font-medium text-slate-900">{selectedUser.full_name ?? '(sans nom)'}</div>
                    <div className="text-xs text-slate-500">{selectedUser.phone} · {selectedUser.role}</div>
                  </div>
                  <button
                    onClick={() => { setSelectedUser(null); setUserSearch(''); }}
                    className="text-xs text-slate-500 hover:text-slate-900"
                  >
                    Changer
                  </button>
                </div>
              ) : (
                <>
                  <input
                    type="text"
                    value={userSearch}
                    onChange={(e) => setUserSearch(e.target.value)}
                    placeholder="Tapez au moins 2 caractères…"
                    className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
                  />
                  {userLookup.data && userLookup.data.length > 0 && (
                    <div className="mt-2 border border-slate-200 rounded-lg max-h-64 overflow-auto">
                      {userLookup.data.map((u) => (
                        <button
                          key={u.id}
                          onClick={() => setSelectedUser(u)}
                          className="w-full text-left px-3 py-2 text-sm hover:bg-slate-50 border-b last:border-b-0"
                        >
                          <div className="font-medium text-slate-900">{u.full_name ?? '(sans nom)'}</div>
                          <div className="text-xs text-slate-500">{u.phone} · {u.role}</div>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          <div className="mb-4">
            <span className="block text-xs text-slate-600 mb-1">Titre</span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={120}
              placeholder="Ex. Promotion ce weekend"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
            />
            <div className="text-[10px] text-slate-400 mt-1 text-right">{title.length} / 120</div>
          </div>

          <div className="mb-4">
            <span className="block text-xs text-slate-600 mb-1">Message</span>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              maxLength={500}
              rows={3}
              placeholder="Détails du message…"
              className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 resize-y"
            />
            <div className="text-[10px] text-slate-400 mt-1 text-right">{body.length} / 500</div>
          </div>

          {error && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3 mb-3">
              {error}
            </div>
          )}

          <div className="flex items-center justify-end gap-2">
            {sentAt && Date.now() - sentAt < 4000 && (
              <span className="text-sm text-emerald-600 font-medium">✓ Envoyé</span>
            )}
            <button
              onClick={() => send.mutate()}
              disabled={!canSend || send.isPending}
              className="px-4 py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg disabled:opacity-50"
            >
              {send.isPending ? 'Envoi…' : 'Envoyer'}
            </button>
          </div>
        </section>

        <section className="card overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-200">
            <h2 className="font-semibold text-slate-900">Historique</h2>
          </div>
          {campaigns.isLoading && <div className="p-5 text-slate-500 text-sm">Chargement…</div>}
          {campaigns.data && campaigns.data.length === 0 && (
            <div className="p-5 text-slate-500 text-sm">Aucune notification envoyée pour le moment.</div>
          )}
          {campaigns.data && campaigns.data.length > 0 && (
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Date</th>
                  <th className="text-left px-4 py-2 font-medium">Cible</th>
                  <th className="text-left px-4 py-2 font-medium">Titre</th>
                  <th className="text-right px-4 py-2 font-medium">Reçues</th>
                  <th className="text-right px-4 py-2 font-medium">Lues</th>
                  <th className="text-right px-4 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody>
                {campaigns.data.map((c) => (
                  <tr key={c.id} className="border-t border-slate-100">
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                      {new Date(c.createdAt).toLocaleString('fr-FR', {
                        day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
                      })}
                    </td>
                    <td className="px-4 py-3 text-slate-600">
                      {targetLabel(c.targetType, c.targetValue)}
                    </td>
                    <td className="px-4 py-3 text-slate-900">
                      <div className="font-medium flex items-center gap-2">
                        {c.title}
                        {c.updatedAt && (
                          <span className="text-[10px] font-normal text-amber-600 bg-amber-50 border border-amber-200 rounded px-1.5 py-0.5">
                            modifié
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 line-clamp-1">{c.body}</div>
                    </td>
                    <td className="px-4 py-3 text-right text-slate-700 tabular-nums">{c.recipientCount}</td>
                    <td className="px-4 py-3 text-right text-slate-700 tabular-nums">
                      {c.readCount}
                      {c.recipientCount > 0 && (
                        <span className="ml-1 text-xs text-slate-400">
                          ({Math.round((c.readCount / c.recipientCount) * 100)}%)
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button
                        onClick={() => startEdit(c)}
                        className="text-xs font-medium text-brand-700 hover:text-brand-900"
                      >
                        Éditer
                      </button>
                      <button
                        onClick={() => confirmDelete(c)}
                        disabled={del.isPending}
                        className="ml-3 text-xs font-medium text-red-600 hover:text-red-800 disabled:opacity-50"
                      >
                        Supprimer
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      {editing && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          onClick={() => !edit.isPending && setEditing(null)}
        >
          <div
            className="card w-full max-w-lg p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="font-semibold text-slate-900 mb-1">Modifier la notification</h2>
            <p className="text-xs text-slate-500 mb-4">
              La correction remplace le texte dans la boîte de réception de tous les
              destinataires ({editing.recipientCount}). Aucune nouvelle notification
              push n’est envoyée.
            </p>

            <div className="mb-4">
              <span className="block text-xs text-slate-600 mb-1">Titre</span>
              <input
                type="text"
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                maxLength={120}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500"
              />
              <div className="text-[10px] text-slate-400 mt-1 text-right">{editTitle.length} / 120</div>
            </div>

            <div className="mb-4">
              <span className="block text-xs text-slate-600 mb-1">Message</span>
              <textarea
                value={editBody}
                onChange={(e) => setEditBody(e.target.value)}
                maxLength={500}
                rows={3}
                className="w-full px-3 py-2 text-sm border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 resize-y"
              />
              <div className="text-[10px] text-slate-400 mt-1 text-right">{editBody.length} / 500</div>
            </div>

            {editError && (
              <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-3 mb-3">
                {editError}
              </div>
            )}

            <div className="flex items-center justify-end gap-2">
              <button
                onClick={() => setEditing(null)}
                disabled={edit.isPending}
                className="px-4 py-2 text-sm font-medium bg-white border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 disabled:opacity-50"
              >
                Annuler
              </button>
              <button
                onClick={() => edit.mutate()}
                disabled={!canEdit || edit.isPending}
                className="px-4 py-2 text-sm font-medium bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg disabled:opacity-50"
              >
                {edit.isPending ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}

function targetLabel(targetType: string, value: string | null): string {
  if (targetType === 'all_captains') return 'Tous les chauffeurs';
  if (targetType === 'all_riders') return 'Tous les passagers';
  if (targetType === 'all_users') return 'Tous les utilisateurs';
  if (targetType === 'group') return GROUP_LABELS[value as GroupKey] ?? value ?? 'Groupe';
  if (targetType === 'user') return `Utilisateur ${value?.slice(0, 8) ?? ''}…`;
  return targetType;
}
