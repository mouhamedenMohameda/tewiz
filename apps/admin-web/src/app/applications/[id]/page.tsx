'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppShell } from '@/components/AppShell';
import { AuthImage } from '@/components/AuthImage';
import { api } from '@/lib/api';
import { APP_NAME } from '@/lib/brand';
import { DOCUMENT_LABELS, DOCUMENT_TYPES, type ApplicationDetail, type DocumentType } from '@/lib/types';
import clsx from 'clsx';

export default function ApplicationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const qc = useQueryClient();

  const { data, isLoading, error } = useQuery({
    queryKey: ['application', id],
    queryFn: async () => {
      const r = await api.get<ApplicationDetail>(`/admin/applications/${id}`);
      return r.data;
    },
    refetchInterval: 0,
  });

  // Which document types the admin has marked as required globally. Optional
  // types are still rendered (and uploadable) but don't gate the approve
  // button.
  const { data: requirements } = useQuery({
    queryKey: ['document-requirements'],
    queryFn: async () => {
      const r = await api.get<{ type: DocumentType; isRequired: boolean }[]>(
        '/admin/document-requirements',
      );
      return r.data;
    },
    staleTime: 30_000,
  });

  const claim = useMutation({
    mutationFn: () => api.post(`/admin/applications/${id}/claim`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['application', id] }),
  });

  const reviewDoc = useMutation({
    mutationFn: ({ docId, status, reason }: { docId: string; status: 'approved' | 'rejected'; reason?: string }) =>
      api.patch(`/admin/applications/${id}/documents/${docId}`, { status, rejectReason: reason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['application', id] }),
  });

  const [captainPassword, setCaptainPassword] = useState<string | null>(null);
  const [regeneratedPassword, setRegeneratedPassword] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  function extractError(e: unknown): string {
    // Axios error: pull the API-provided code/message when present so the admin
    // sees WHY the approval failed instead of a silent no-op. The API wraps
    // errors as `{ error: { code, message, details } }`, but older paths /
    // proxies sometimes return `{ code, message }` flat — handle both.
    const err = e as {
      response?: {
        data?: {
          error?: { code?: string; message?: string; details?: unknown };
          code?: string;
          message?: string;
          details?: unknown;
        };
        status?: number;
      };
      message?: string;
    };
    const data = err?.response?.data;
    const payload = data?.error ?? data;
    if (payload?.message) {
      const details = payload.details ? ` — ${JSON.stringify(payload.details)}` : '';
      return `${payload.code ?? 'error'}: ${payload.message}${details}`;
    }
    if (err?.response?.status) return `HTTP ${err.response.status}`;
    return err?.message ?? 'Erreur inconnue';
  }

  const approveApp = useMutation({
    mutationFn: async () => {
      const r = await api.post<{ captainPassword: string | null }>(`/admin/applications/${id}/approve`);
      return r.data;
    },
    onSuccess: (res) => {
      setActionError(null);
      // A guest-originated captain gets fresh login credentials — show them once
      // so the admin can forward them. Otherwise go straight back to the list.
      if (res.captainPassword) setCaptainPassword(res.captainPassword);
      else router.replace('/applications');
    },
    onError: (e) => setActionError(extractError(e)),
  });

  const regeneratePassword = useMutation({
    mutationFn: async (userId: string) => {
      const r = await api.post<{ password: string }>(
        `/admin/users/${userId}/regenerate-password`,
      );
      return r.data.password;
    },
    onSuccess: (password) => setRegeneratedPassword(password),
  });

  const reqCorr = useMutation({
    mutationFn: (notes: string) => api.post(`/admin/applications/${id}/request-corrections`, { notes }),
    onSuccess: () => router.replace('/applications'),
    onError: (e) => setActionError(extractError(e)),
  });

  const rejectApp = useMutation({
    mutationFn: (reason: string) => api.post(`/admin/applications/${id}/reject`, { reason }),
    onSuccess: () => router.replace('/applications'),
    onError: (e) => setActionError(extractError(e)),
  });

  const [activeDoc, setActiveDoc] = useState<DocumentType | null>(null);
  const [rejectingDocId, setRejectingDocId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const [showCorrModal, setShowCorrModal] = useState(false);
  const [corrNotes, setCorrNotes] = useState('');
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [appRejectReason, setAppRejectReason] = useState('');

  if (isLoading) return <AppShell><div className="p-6 text-slate-500">Chargement...</div></AppShell>;
  if (error || !data) return <AppShell><div className="p-6 text-red-600">Erreur</div></AppShell>;

  const app = data.application;
  // Default to "all required" until the requirements query returns, so we
  // never let admins approve before the gate config has loaded.
  const requiredTypes = new Set<DocumentType>(
    requirements
      ? requirements.filter((r) => r.isRequired).map((r) => r.type)
      : DOCUMENT_TYPES,
  );
  const byType = new Map(data.documents.map((d) => [d.type, d] as const));
  // Approve gate: every required type must be present AND approved. Optional
  // types (and any extra docs the captain uploaded) don't block approval.
  const requiredReady = [...requiredTypes].every((t) => byType.get(t)?.status === 'approved');
  const missingRequired = [...requiredTypes].filter((t) => !byType.has(t));
  const hasAnyRequired = requiredTypes.size > 0;

  return (
    <AppShell>
      <div className="p-6 max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6">
          <button onClick={() => router.back()} className="text-sm text-slate-500 hover:text-slate-700 mb-2">
            ← Retour
          </button>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-slate-900">{app.full_name ?? 'Sans nom'}</h1>
              <p className="text-sm text-slate-500">{app.phone}</p>
            </div>
            <div className="flex flex-col items-end gap-2">
              <span className={clsx(
                'badge',
                app.status === 'submitted' && 'badge-pending',
                app.status === 'under_review' && 'badge-info',
                app.status === 'approved' && 'badge-approved',
                app.status === 'rejected' && 'badge-rejected',
                app.status === 'needs_correction' && 'badge-pending',
              )}>
                {app.status}
              </span>
              {app.status === 'submitted' && (
                <button onClick={() => claim.mutate()} className="btn-secondary text-xs">
                  Prendre en charge
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Personal + Vehicle info */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
          <div className="card p-5">
            <h2 className="font-semibold text-slate-900 mb-3">Identité</h2>
            <dl className="space-y-2 text-sm">
              <Row label="NNI" value={app.nni} />
              <Row label="Date naissance" value={app.date_of_birth} />
              <Row label="Adresse" value={app.address_label} />
              <Row label="Contact urgence" value={app.emergency_contact_name} />
              <Row label="Tel urgence" value={app.emergency_contact_phone} />
            </dl>
          </div>
          <div className="card p-5">
            <h2 className="font-semibold text-slate-900 mb-3">Véhicule</h2>
            <dl className="space-y-2 text-sm">
              <Row label="Plaque" value={app.vehicle_plate} />
              <Row label="Marque/Modèle" value={[app.vehicle_brand, app.vehicle_model].filter(Boolean).join(' ') || null} />
              <Row label="Année" value={String(app.vehicle_year ?? '—')} />
              <Row label="Couleur" value={app.vehicle_color} />
              <Row label="Places" value={String(app.vehicle_seats ?? '—')} />
              <Row label="Accepte colis" value={app.accepts_colis ? 'Oui' : 'Non'} />
            </dl>
          </div>
        </div>

        {/* Documents */}
        <div className="card p-5 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-900">
              Documents ({data.documents.length}/{DOCUMENT_TYPES.length})
            </h2>
            {missingRequired.length > 0 && (
              <span className="text-xs text-red-600">
                ⚠ {missingRequired.length} document{missingRequired.length > 1 ? 's' : ''} requis manquant{missingRequired.length > 1 ? 's' : ''}
              </span>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {DOCUMENT_TYPES.map((type) => {
              const doc = byType.get(type);
              const required = requiredTypes.has(type);
              return (
                <div key={type} className="border border-slate-200 rounded-lg overflow-hidden">
                  <div className="aspect-[4/3] bg-slate-50 relative">
                    {doc ? (
                      <button
                        onClick={() => setActiveDoc(type)}
                        className="w-full h-full"
                      >
                        <AuthImage
                          src={`/admin/applications/${id}/documents/${doc.id}/file`}
                          alt={type}
                          className="w-full h-full object-cover"
                        />
                      </button>
                    ) : (
                      <div className={clsx(
                        'w-full h-full flex items-center justify-center text-xs',
                        required ? 'text-red-500' : 'text-slate-400',
                      )}>
                        {required ? 'Manquant' : 'Non requis'}
                      </div>
                    )}
                  </div>
                  <div className="p-3">
                    <div className="flex items-center justify-between gap-2 mb-1">
                      <div className="text-xs font-medium text-slate-900">
                        {DOCUMENT_LABELS[type]}
                      </div>
                      <span className={clsx(
                        'text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded',
                        required
                          ? 'bg-slate-100 text-slate-600'
                          : 'bg-amber-50 text-amber-700',
                      )}>
                        {required ? 'requis' : 'facultatif'}
                      </span>
                    </div>
                    {doc && (
                      <div className="flex flex-col gap-1">
                        <span className={clsx(
                          'badge text-[10px]',
                          doc.status === 'pending' && 'badge-pending',
                          doc.status === 'approved' && 'badge-approved',
                          doc.status === 'rejected' && 'badge-rejected',
                          doc.status === 'expired' && 'badge-rejected',
                        )}>{doc.status}</span>
                        {doc.expires_at && (
                          <span className="text-[10px] text-slate-500">
                            Exp: {new Date(doc.expires_at).toLocaleDateString('fr-FR')}
                          </span>
                        )}
                        {doc.reject_reason && (
                          <span className="text-[10px] text-red-600">{doc.reject_reason}</span>
                        )}
                        {doc.status === 'pending' && (
                          <div className="flex gap-1 mt-1">
                            <button
                              onClick={() => reviewDoc.mutate({ docId: doc.id, status: 'approved' })}
                              className="flex-1 px-2 py-1 text-[10px] rounded bg-green-100 text-green-800 hover:bg-green-200"
                            >✓</button>
                            <button
                              onClick={() => { setRejectingDocId(doc.id); setRejectReason(''); }}
                              className="flex-1 px-2 py-1 text-[10px] rounded bg-red-100 text-red-800 hover:bg-red-200"
                            >✗</button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Action bar */}
        {(app.status === 'submitted' || app.status === 'under_review') && (
          <div className="card p-5">
            {actionError && (
              <div className="mb-3 px-3 py-2 rounded bg-red-50 border border-red-200 text-sm text-red-700 break-words">
                {actionError}
              </div>
            )}
            <div className="flex flex-wrap gap-3 items-center justify-end">
              <button
                onClick={() => setShowRejectModal(true)}
                className="btn-danger"
              >Refuser définitivement</button>
              <button
                onClick={() => setShowCorrModal(true)}
                className="btn-secondary"
              >Demander corrections</button>
              <button
                onClick={() => { setActionError(null); approveApp.mutate(); }}
                disabled={!hasAnyRequired || !requiredReady || approveApp.isPending}
                className="btn-primary"
                title={
                  !hasAnyRequired
                    ? "Aucun document n'est marqué comme requis"
                    : !requiredReady
                    ? 'Tous les documents requis doivent être présents et approuvés'
                    : 'Approuver'
                }
              >{approveApp.isPending ? 'Approbation…' : 'Approuver le dossier'}</button>
            </div>
          </div>
        )}

        {/* Approved-captain actions: regenerate password */}
        {app.status === 'approved' && app.user_id && (
          <div className="card p-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <h2 className="font-semibold text-slate-900 mb-1">Mot de passe</h2>
                <p className="text-sm text-slate-500">
                  Pour des raisons de sécurité, le mot de passe actuel n&apos;est pas
                  consultable. Vous pouvez en générer un nouveau et le transmettre
                  au chauffeur.
                </p>
              </div>
              <button
                onClick={() => regeneratePassword.mutate(app.user_id!)}
                disabled={regeneratePassword.isPending}
                className="btn-secondary whitespace-nowrap"
              >
                {regeneratePassword.isPending ? 'Génération…' : 'Régénérer le mot de passe'}
              </button>
            </div>
          </div>
        )}

        {/* Modals */}
        {rejectingDocId && (
          <Modal title="Refuser ce document" onClose={() => setRejectingDocId(null)}>
            <label className="block text-sm text-slate-700 mb-1">Raison</label>
            <input
              autoFocus value={rejectReason} onChange={(e) => setRejectReason(e.target.value)}
              className="input mb-4" placeholder="Photo floue, document expiré..."
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setRejectingDocId(null)} className="btn-ghost">Annuler</button>
              <button
                onClick={() => {
                  reviewDoc.mutate({ docId: rejectingDocId!, status: 'rejected', reason: rejectReason });
                  setRejectingDocId(null);
                }}
                disabled={rejectReason.length < 2}
                className="btn-danger"
              >Refuser</button>
            </div>
          </Modal>
        )}

        {showCorrModal && (
          <Modal title="Demander des corrections" onClose={() => setShowCorrModal(false)}>
            <label className="block text-sm text-slate-700 mb-1">Message au chauffeur</label>
            <textarea
              autoFocus rows={4} value={corrNotes} onChange={(e) => setCorrNotes(e.target.value)}
              className="input mb-4" placeholder="Veuillez re-uploader le NNI lisible..."
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowCorrModal(false)} className="btn-ghost">Annuler</button>
              <button
                onClick={() => reqCorr.mutate(corrNotes)}
                disabled={corrNotes.length < 5}
                className="btn-primary"
              >Envoyer</button>
            </div>
          </Modal>
        )}

        {showRejectModal && (
          <Modal title="Refuser définitivement" onClose={() => setShowRejectModal(false)}>
            <label className="block text-sm text-slate-700 mb-1">Raison du refus</label>
            <textarea
              autoFocus rows={4} value={appRejectReason} onChange={(e) => setAppRejectReason(e.target.value)}
              className="input mb-4"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => setShowRejectModal(false)} className="btn-ghost">Annuler</button>
              <button
                onClick={() => rejectApp.mutate(appRejectReason)}
                disabled={appRejectReason.length < 5}
                className="btn-danger"
              >Refuser</button>
            </div>
          </Modal>
        )}

        {captainPassword && (
          <Modal title="Chauffeur approuvé" onClose={() => router.replace('/applications')}>
            <p className="text-sm text-slate-600 mb-3">
              {app.full_name ?? 'Le chauffeur'} peut maintenant se connecter sur l&apos;app.
              Transmettez-lui ce mot de passe (affiché une seule fois) :
            </p>
            <div className="flex items-center gap-2 mb-4">
              <code className="flex-1 px-3 py-2 bg-slate-100 rounded font-mono text-lg tracking-wider text-slate-900">
                {captainPassword}
              </code>
              <button
                onClick={() => navigator.clipboard?.writeText(captainPassword)}
                className="btn-secondary text-xs"
              >Copier</button>
            </div>
            <div className="flex justify-end gap-2">
              <a
                href={`https://wa.me/${app.phone.replace(/[^\d]/g, '')}?text=${encodeURIComponent(
                  `Bonjour ${app.full_name ?? ''}, votre compte chauffeur ${APP_NAME} est validé. Mot de passe : ${captainPassword}`,
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary"
              >Envoyer via WhatsApp</a>
              <button onClick={() => router.replace('/applications')} className="btn-ghost">Fermer</button>
            </div>
          </Modal>
        )}

        {regeneratedPassword && (
          <Modal title="Nouveau mot de passe" onClose={() => setRegeneratedPassword(null)}>
            <p className="text-sm text-slate-600 mb-3">
              Le mot de passe de {app.full_name ?? 'ce chauffeur'} a été régénéré.
              Toutes ses sessions ont été déconnectées. Transmettez-lui ce nouveau
              mot de passe (affiché une seule fois) :
            </p>
            <div className="flex items-center gap-2 mb-4">
              <code className="flex-1 px-3 py-2 bg-slate-100 rounded font-mono text-lg tracking-wider text-slate-900">
                {regeneratedPassword}
              </code>
              <button
                onClick={() => navigator.clipboard?.writeText(regeneratedPassword)}
                className="btn-secondary text-xs"
              >Copier</button>
            </div>
            <div className="flex justify-end gap-2">
              <a
                href={`https://wa.me/${app.phone.replace(/[^\d]/g, '')}?text=${encodeURIComponent(
                  `Bonjour ${app.full_name ?? ''}, votre nouveau mot de passe ${APP_NAME} : ${regeneratedPassword}`,
                )}`}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary"
              >Envoyer via WhatsApp</a>
              <button onClick={() => setRegeneratedPassword(null)} className="btn-ghost">Fermer</button>
            </div>
          </Modal>
        )}

        {activeDoc && byType.get(activeDoc) && (
          <Modal title={DOCUMENT_LABELS[activeDoc]} onClose={() => setActiveDoc(null)} wide>
            <AuthImage
              src={`/admin/applications/${id}/documents/${byType.get(activeDoc)!.id}/file`}
              alt={activeDoc}
              className="w-full h-auto rounded"
            />
          </Modal>
        )}
      </div>
    </AppShell>
  );
}

function Row({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div className="grid grid-cols-3 gap-2">
      <dt className="text-slate-500 col-span-1">{label}</dt>
      <dd className="col-span-2 text-slate-900">{value || <span className="text-slate-400">—</span>}</dd>
    </div>
  );
}

function Modal({
  title, children, onClose, wide,
}: {
  title: string; children: React.ReactNode; onClose: () => void; wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 bg-slate-900/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        className={clsx(
          'bg-white rounded-xl shadow-xl w-full max-h-[90vh] overflow-auto',
          wide ? 'max-w-3xl' : 'max-w-md',
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between">
          <h3 className="font-semibold text-slate-900">{title}</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700">✕</button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}
