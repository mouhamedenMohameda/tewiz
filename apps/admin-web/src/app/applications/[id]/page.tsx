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
  const [actionError, setActionError] = useState<ParsedApiError | null>(null);

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
    onError: (e) => setActionError(parseApiError(e)),
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
    onError: (e) => setActionError(parseApiError(e)),
  });

  const rejectApp = useMutation({
    mutationFn: (reason: string) => api.post(`/admin/applications/${id}/reject`, { reason }),
    onSuccess: () => router.replace('/applications'),
    onError: (e) => setActionError(parseApiError(e)),
  });

  const [activeDoc, setActiveDoc] = useState<DocumentType | null>(null);
  const [rejectingDocId, setRejectingDocId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const [showCorrModal, setShowCorrModal] = useState(false);
  const [corrNotes, setCorrNotes] = useState('');
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [appRejectReason, setAppRejectReason] = useState('');

  // Per-field "this is wrong" flags raised by the reviewer on the identity /
  // vehicle cards. Local state only — they're materialised as text inside the
  // correction-request message sent to the captain, no DB shape needed.
  const [fieldFlags, setFieldFlags] = useState<{ key: string; label: string; reason: string }[]>([]);
  const [flaggingField, setFlaggingField] = useState<{ key: string; label: string } | null>(null);
  const [flagReason, setFlagReason] = useState('');

  function upsertFlag(key: string, label: string, reason: string) {
    setFieldFlags((prev) => {
      const others = prev.filter((f) => f.key !== key);
      return [...others, { key, label, reason }];
    });
  }
  function removeFlag(key: string) {
    setFieldFlags((prev) => prev.filter((f) => f.key !== key));
  }
  function buildCorrectionMessage(): string {
    if (fieldFlags.length === 0) return '';
    const header = 'Corrections demandées :';
    const lines = fieldFlags.map((f) => `- ${f.label} : ${f.reason}`);
    return [header, ...lines].join('\n');
  }

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
              <Row k="identity.nni" label="NNI" value={app.nni}
                flag={fieldFlags.find((f) => f.key === 'identity.nni')}
                onFlag={(k, l) => { setFlaggingField({ key: k, label: l }); setFlagReason(fieldFlags.find((f) => f.key === k)?.reason ?? ''); }}
                onUnflag={removeFlag} />
              <Row k="identity.date_of_birth" label="Date naissance" value={app.date_of_birth}
                flag={fieldFlags.find((f) => f.key === 'identity.date_of_birth')}
                onFlag={(k, l) => { setFlaggingField({ key: k, label: l }); setFlagReason(fieldFlags.find((f) => f.key === k)?.reason ?? ''); }}
                onUnflag={removeFlag} />
              <Row k="identity.address" label="Adresse" value={app.address_label}
                flag={fieldFlags.find((f) => f.key === 'identity.address')}
                onFlag={(k, l) => { setFlaggingField({ key: k, label: l }); setFlagReason(fieldFlags.find((f) => f.key === k)?.reason ?? ''); }}
                onUnflag={removeFlag} />
              <Row k="identity.emergency_contact_name" label="Contact urgence" value={app.emergency_contact_name}
                flag={fieldFlags.find((f) => f.key === 'identity.emergency_contact_name')}
                onFlag={(k, l) => { setFlaggingField({ key: k, label: l }); setFlagReason(fieldFlags.find((f) => f.key === k)?.reason ?? ''); }}
                onUnflag={removeFlag} />
              <Row k="identity.emergency_contact_phone" label="Tel urgence" value={app.emergency_contact_phone}
                flag={fieldFlags.find((f) => f.key === 'identity.emergency_contact_phone')}
                onFlag={(k, l) => { setFlaggingField({ key: k, label: l }); setFlagReason(fieldFlags.find((f) => f.key === k)?.reason ?? ''); }}
                onUnflag={removeFlag} />
            </dl>
          </div>
          <div className="card p-5">
            <h2 className="font-semibold text-slate-900 mb-3">Véhicule</h2>
            <dl className="space-y-2 text-sm">
              <Row k="vehicle.plate" label="Plaque" value={app.vehicle_plate}
                flag={fieldFlags.find((f) => f.key === 'vehicle.plate')}
                onFlag={(k, l) => { setFlaggingField({ key: k, label: l }); setFlagReason(fieldFlags.find((f) => f.key === k)?.reason ?? ''); }}
                onUnflag={removeFlag} />
              <Row k="vehicle.brand_model" label="Marque/Modèle" value={[app.vehicle_brand, app.vehicle_model].filter(Boolean).join(' ') || null}
                flag={fieldFlags.find((f) => f.key === 'vehicle.brand_model')}
                onFlag={(k, l) => { setFlaggingField({ key: k, label: l }); setFlagReason(fieldFlags.find((f) => f.key === k)?.reason ?? ''); }}
                onUnflag={removeFlag} />
              <Row k="vehicle.year" label="Année" value={String(app.vehicle_year ?? '—')}
                flag={fieldFlags.find((f) => f.key === 'vehicle.year')}
                onFlag={(k, l) => { setFlaggingField({ key: k, label: l }); setFlagReason(fieldFlags.find((f) => f.key === k)?.reason ?? ''); }}
                onUnflag={removeFlag} />
              <Row k="vehicle.color" label="Couleur" value={app.vehicle_color}
                flag={fieldFlags.find((f) => f.key === 'vehicle.color')}
                onFlag={(k, l) => { setFlaggingField({ key: k, label: l }); setFlagReason(fieldFlags.find((f) => f.key === k)?.reason ?? ''); }}
                onUnflag={removeFlag} />
              <Row k="vehicle.seats" label="Places" value={String(app.vehicle_seats ?? '—')}
                flag={fieldFlags.find((f) => f.key === 'vehicle.seats')}
                onFlag={(k, l) => { setFlaggingField({ key: k, label: l }); setFlagReason(fieldFlags.find((f) => f.key === k)?.reason ?? ''); }}
                onUnflag={removeFlag} />
              <Row k="vehicle.accepts_colis" label="Accepte colis" value={app.accepts_colis ? 'Oui' : 'Non'}
                flag={fieldFlags.find((f) => f.key === 'vehicle.accepts_colis')}
                onFlag={(k, l) => { setFlaggingField({ key: k, label: l }); setFlagReason(fieldFlags.find((f) => f.key === k)?.reason ?? ''); }}
                onUnflag={removeFlag} />
            </dl>
          </div>
        </div>

        {fieldFlags.length > 0 && (
          <div className="card p-5 mb-6 border-amber-200 bg-amber-50/40">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-amber-900">
                🚩 Problèmes signalés ({fieldFlags.length})
              </h2>
              <button onClick={() => setFieldFlags([])} className="text-xs text-amber-700 hover:text-amber-900 underline">
                Tout effacer
              </button>
            </div>
            <ul className="space-y-2 text-sm">
              {fieldFlags.map((f) => (
                <li key={f.key} className="flex items-start gap-2">
                  <span className="text-amber-600 mt-0.5">•</span>
                  <span className="flex-1">
                    <span className="font-medium text-slate-900">{f.label}</span>
                    <span className="text-slate-600"> : {f.reason}</span>
                  </span>
                  <button onClick={() => removeFlag(f.key)} className="text-slate-400 hover:text-red-600 text-xs">
                    ✕
                  </button>
                </li>
              ))}
            </ul>
            <p className="text-xs text-amber-700/80 mt-3">
              Ces problèmes seront inclus automatiquement dans le message envoyé au chauffeur quand tu cliqueras sur <strong>Demander corrections</strong>.
            </p>
          </div>
        )}

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
                        {/* Approve / reject controls. Visible at all times so an
                            admin can REVOKE an earlier approval (or reverse a
                            rejection) when they realise they were wrong — e.g.
                            before sending the dossier back for corrections.
                            The button matching the current status is highlighted
                            and disabled. */}
                        <div className="flex gap-1 mt-1">
                          <button
                            onClick={() => reviewDoc.mutate({ docId: doc.id, status: 'approved' })}
                            disabled={doc.status === 'approved' || reviewDoc.isPending}
                            title="Approuver"
                            className={clsx(
                              'flex-1 px-2 py-1 text-[10px] rounded transition',
                              doc.status === 'approved'
                                ? 'bg-green-200 text-green-900 cursor-default'
                                : 'bg-slate-100 text-slate-600 hover:bg-green-100 hover:text-green-800',
                            )}
                          >✓ Approuver</button>
                          <button
                            onClick={() => { setRejectingDocId(doc.id); setRejectReason(doc.reject_reason ?? ''); }}
                            disabled={reviewDoc.isPending}
                            title={doc.status === 'approved'
                              ? 'Annuler cette approbation et marquer comme à corriger'
                              : 'Rejeter ce document'}
                            className={clsx(
                              'flex-1 px-2 py-1 text-[10px] rounded transition',
                              doc.status === 'rejected'
                                ? 'bg-red-200 text-red-900 cursor-default'
                                : 'bg-slate-100 text-slate-600 hover:bg-red-100 hover:text-red-800',
                            )}
                          >{doc.status === 'approved' ? '↩ Annuler' : '✗ Rejeter'}</button>
                        </div>
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
              <ErrorAlert error={actionError} onDismiss={() => setActionError(null)} />
            )}
            <div className="flex flex-wrap gap-3 items-center justify-end">
              <button
                onClick={() => setShowRejectModal(true)}
                className="btn-danger"
              >Refuser définitivement</button>
              <button
                onClick={() => {
                  setCorrNotes((prev) => prev || buildCorrectionMessage());
                  setShowCorrModal(true);
                }}
                className="btn-secondary"
                title={fieldFlags.length > 0
                  ? `${fieldFlags.length} problème(s) signalé(s) seront inclus dans le message`
                  : undefined}
              >
                Demander corrections{fieldFlags.length > 0 ? ` (${fieldFlags.length})` : ''}
              </button>
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

        {flaggingField && (
          <Modal
            title={`Signaler un problème — ${flaggingField.label}`}
            onClose={() => { setFlaggingField(null); setFlagReason(''); }}
          >
            <p className="text-sm text-slate-600 mb-3">
              Décris ce qui ne va pas avec ce champ. Le chauffeur recevra le détail
              quand tu cliqueras sur <strong>Demander corrections</strong>.
            </p>
            <textarea
              autoFocus rows={3} value={flagReason} onChange={(e) => setFlagReason(e.target.value)}
              className="input mb-4" placeholder="Ex. NNI illisible, plaque ne correspond pas à la carte grise…"
            />
            <div className="flex justify-end gap-2">
              <button onClick={() => { setFlaggingField(null); setFlagReason(''); }} className="btn-ghost">
                Annuler
              </button>
              <button
                onClick={() => {
                  upsertFlag(flaggingField.key, flaggingField.label, flagReason.trim());
                  setFlaggingField(null);
                  setFlagReason('');
                }}
                disabled={flagReason.trim().length < 2}
                className="btn-primary"
              >Signaler</button>
            </div>
          </Modal>
        )}

        {showCorrModal && (
          <Modal title="Demander des corrections" onClose={() => setShowCorrModal(false)}>
            <label className="block text-sm text-slate-700 mb-1">Message au chauffeur</label>
            <textarea
              autoFocus rows={6} value={corrNotes} onChange={(e) => setCorrNotes(e.target.value)}
              className="input mb-2" placeholder="Veuillez re-uploader le NNI lisible..."
            />
            {fieldFlags.length > 0 && corrNotes !== buildCorrectionMessage() && (
              <button
                type="button"
                onClick={() => setCorrNotes(buildCorrectionMessage())}
                className="text-xs text-brand-700 hover:underline mb-3 block"
              >
                ↻ Repré-remplir avec les {fieldFlags.length} problème(s) signalé(s)
              </button>
            )}
            <div className="flex justify-end gap-2 mt-2">
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

function Row({
  k, label, value, flag, onFlag, onUnflag,
}: {
  k: string;
  label: string;
  value: string | null | undefined;
  flag?: { key: string; label: string; reason: string };
  onFlag: (key: string, label: string) => void;
  onUnflag: (key: string) => void;
}) {
  return (
    <div className="grid grid-cols-[1fr_2fr_auto] gap-2 items-start group">
      <dt className="text-slate-500">{label}</dt>
      <dd className={clsx('text-slate-900', flag && 'line-through decoration-amber-500/60')}>
        {value || <span className="text-slate-400">—</span>}
        {flag && (
          <div className="mt-1 text-[11px] text-amber-700 not-italic no-underline">
            🚩 {flag.reason}
          </div>
        )}
      </dd>
      {flag ? (
        <button
          onClick={() => onUnflag(k)}
          title="Retirer le signalement"
          className="text-amber-600 hover:text-amber-800 text-xs px-1.5 py-0.5 rounded hover:bg-amber-100"
        >
          ✕
        </button>
      ) : (
        <button
          onClick={() => onFlag(k, label)}
          title="Signaler un problème sur ce champ"
          className="text-slate-300 hover:text-amber-600 text-xs px-1.5 py-0.5 rounded hover:bg-amber-50 opacity-0 group-hover:opacity-100 transition"
        >
          🚩
        </button>
      )}
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

// ─── Error helpers ───────────────────────────────────────────────────────────

interface ParsedApiError {
  code: string;
  message: string;
  status?: number;
}

function parseApiError(e: unknown): ParsedApiError {
  // The API wraps errors as `{ error: { code, message, details } }`. Some
  // proxies/older paths return `{ code, message }` flat; handle both shapes.
  const err = e as {
    response?: {
      data?: {
        error?: { code?: string; message?: string };
        code?: string;
        message?: string;
      };
      status?: number;
    };
    message?: string;
  };
  const data = err?.response?.data;
  const payload = data?.error ?? data;
  return {
    code: payload?.code ?? 'unknown_error',
    message: payload?.message ?? err?.message ?? 'Une erreur inattendue est survenue.',
    status: err?.response?.status,
  };
}

// Friendly French translation of known API error codes. When a code isn't in
// the map we still show the raw API message, but with a generic "Erreur" title
// so the operator at least sees something readable.
const ERROR_PRESETS: Record<string, { title: string; hint?: string }> = {
  plate_taken: {
    title: 'Plaque déjà utilisée',
    hint: 'Vérifie dans la liste Chauffeurs qui possède déjà cette plaque, ou demande au chauffeur de corriger sa plaque.',
  },
  phone_taken: {
    title: 'Numéro de téléphone déjà utilisé',
    hint: 'Un autre compte utilise déjà ce numéro. Vérifie la liste Utilisateurs.',
  },
  captain_needs_phone: {
    title: 'Numéro de téléphone manquant',
    hint: "Le chauffeur doit avoir un numéro de téléphone avant validation.",
  },
  no_user_id: {
    title: 'Aucun compte lié au dossier',
    hint: "Ce dossier n'est lié à aucun utilisateur. Demande au chauffeur de se reconnecter à l'app puis ressoumettre.",
  },
  wrong_status: {
    title: 'Statut du dossier incompatible',
    hint: "L'action n'est pas autorisée dans l'état actuel du dossier.",
  },
  required_docs_not_ready: {
    title: 'Documents requis incomplets',
    hint: 'Tous les documents marqués comme requis doivent être présents et approuvés.',
  },
  docs_not_all_approved: {
    title: 'Documents non approuvés',
    hint: 'Certains documents sont encore en attente ou rejetés.',
  },
  validation_error: {
    title: 'Données invalides',
  },
  not_found: {
    title: 'Introuvable',
  },
  cannot_claim: {
    title: 'Prise en charge impossible',
  },
};

function ErrorAlert({ error, onDismiss }: { error: ParsedApiError; onDismiss: () => void }) {
  const preset = ERROR_PRESETS[error.code];
  const title = preset?.title ?? 'Erreur';
  return (
    <div
      role="alert"
      className="mb-4 flex gap-3 items-start rounded-lg border border-red-200 bg-red-50 p-4"
    >
      <div className="shrink-0 mt-0.5 h-7 w-7 rounded-full bg-red-100 text-red-600 flex items-center justify-center font-bold">
        !
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-red-900">{title}</div>
        <div className="text-sm text-red-800 mt-0.5 break-words">{error.message}</div>
        {preset?.hint && (
          <div className="text-xs text-red-700/80 mt-2">{preset.hint}</div>
        )}
        <div className="text-[10px] uppercase tracking-wide text-red-500/70 mt-2 font-mono">
          {error.code}{error.status ? ` · HTTP ${error.status}` : ''}
        </div>
      </div>
      <button
        onClick={onDismiss}
        aria-label="Fermer"
        className="shrink-0 text-red-400 hover:text-red-700 text-lg leading-none"
      >
        ✕
      </button>
    </div>
  );
}
