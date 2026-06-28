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

type TargetType = 'all_captains' | 'group' | 'user';
type GroupKey = 'active_captains' | 'bonus_active';

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
            Envoie une notification push + inbox à un chauffeur, un groupe, ou à
            toute la flotte.
          </p>
        </div>

        <section className="card p-5 mb-6">
          <h2 className="font-semibold text-slate-900 mb-3">Nouvelle notification</h2>

          <div className="mb-4">
            <span className="block text-xs text-slate-600 mb-2">Destinataire</span>
            <div className="flex flex-wrap gap-2">
              {(['all_captains', 'group', 'user'] as TargetType[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setTargetType(t)}
                  className={`px-3 py-1.5 text-sm rounded-lg border ${
                    targetType === t
                      ? 'bg-brand-50 border-brand-300 text-brand-700 font-medium'
                      : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50'
                  }`}
                >
                  {t === 'all_captains' ? 'Tous les chauffeurs'
                    : t === 'group'        ? 'Un groupe'
                    : 'Un chauffeur précis'}
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
                      <div className="font-medium">{c.title}</div>
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
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </AppShell>
  );
}

function targetLabel(targetType: string, value: string | null): string {
  if (targetType === 'all_captains') return 'Tous les chauffeurs';
  if (targetType === 'group') return GROUP_LABELS[value as GroupKey] ?? value ?? 'Groupe';
  if (targetType === 'user') return `Utilisateur ${value?.slice(0, 8) ?? ''}…`;
  return targetType;
}
