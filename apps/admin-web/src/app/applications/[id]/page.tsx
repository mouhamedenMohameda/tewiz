'use client';

import { use, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { AppShell } from '@/components/AppShell';
import { AuthImage } from '@/components/AuthImage';
import { api } from '@/lib/api';
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

  const claim = useMutation({
    mutationFn: () => api.post(`/admin/applications/${id}/claim`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['application', id] }),
  });

  const reviewDoc = useMutation({
    mutationFn: ({ docId, status, reason }: { docId: string; status: 'approved' | 'rejected'; reason?: string }) =>
      api.patch(`/admin/applications/${id}/documents/${docId}`, { status, rejectReason: reason }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['application', id] }),
  });

  const approveApp = useMutation({
    mutationFn: () => api.post(`/admin/applications/${id}/approve`),
    onSuccess: () => router.replace('/applications'),
  });

  const reqCorr = useMutation({
    mutationFn: (notes: string) => api.post(`/admin/applications/${id}/request-corrections`, { notes }),
    onSuccess: () => router.replace('/applications'),
  });

  const rejectApp = useMutation({
    mutationFn: (reason: string) => api.post(`/admin/applications/${id}/reject`, { reason }),
    onSuccess: () => router.replace('/applications'),
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
  const allApproved = data.documents.length > 0 && data.documents.every((d) => d.status === 'approved');
  const allTypesPresent = DOCUMENT_TYPES.every((t) => data.documents.some((d) => d.type === t));

  const byType = new Map(data.documents.map((d) => [d.type, d] as const));

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
            {!allTypesPresent && (
              <span className="text-xs text-red-600">⚠ Documents manquants</span>
            )}
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {DOCUMENT_TYPES.map((type) => {
              const doc = byType.get(type);
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
                      <div className="w-full h-full flex items-center justify-center text-slate-400 text-xs">
                        Manquant
                      </div>
                    )}
                  </div>
                  <div className="p-3">
                    <div className="text-xs font-medium text-slate-900 mb-1">
                      {DOCUMENT_LABELS[type]}
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
          <div className="card p-5 flex flex-wrap gap-3 items-center justify-end">
            <button
              onClick={() => setShowRejectModal(true)}
              className="btn-danger"
            >Refuser définitivement</button>
            <button
              onClick={() => setShowCorrModal(true)}
              className="btn-secondary"
            >Demander corrections</button>
            <button
              onClick={() => approveApp.mutate()}
              disabled={!allApproved || !allTypesPresent}
              className="btn-primary"
              title={!allApproved ? 'Tous les documents doivent être approuvés' : 'Approuver'}
            >Approuver le dossier</button>
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
