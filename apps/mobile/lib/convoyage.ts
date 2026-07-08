import { api } from './api';

export type JobStatus = 'open' | 'assigned' | 'completed' | 'cancelled' | 'expired';
export type ProposalStatus = 'pending' | 'accepted' | 'rejected' | 'withdrawn';

export interface ConvoyageJob {
  id: string;
  pickupLabel: string;
  dropoffLabel: string;
  vehiclePlate: string;
  vehicleModel: string | null;
  desiredDate: string | null;
  note: string | null;
  status: JobStatus;
  proposalCount: number;
  provider: { name: string; phone: string; ratingAvg: number | null } | null;
  createdAt: string;
}

export interface Proposal {
  id: string;
  providerName: string;
  providerRating: number | null;
  priceMru: number | null;
  note: string | null;
  status: ProposalStatus;
  createdAt: string;
}

export interface OpenJob {
  id: string;
  pickupLabel: string;
  dropoffLabel: string;
  vehicleModel: string | null;
  desiredDate: string | null;
  note: string | null;
  clientName: string;
  proposalCount: number;
  alreadyProposed: boolean;
  createdAt: string;
}

export interface MyProposal {
  id: string;
  jobId: string;
  pickupLabel: string;
  dropoffLabel: string;
  priceMru: number | null;
  note: string | null;
  status: ProposalStatus;
  jobStatus: JobStatus;
  clientName: string;
  clientPhone: string | null;
  createdAt: string;
}

export const JOB_STATUS_KEYS: Record<JobStatus, string> = {
  open: 'convoyage.jobStatus.open',
  assigned: 'convoyage.jobStatus.assigned',
  completed: 'convoyage.jobStatus.completed',
  cancelled: 'convoyage.jobStatus.cancelled',
  expired: 'convoyage.jobStatus.expired',
};

export interface CreateJobPayload {
  pickup_lat?: number;
  pickup_lng?: number;
  pickup_label: string;
  dropoff_label: string;
  vehicle_plate: string;
  vehicle_model?: string;
  desired_date?: string;
  note?: string;
}

export async function createJob(payload: CreateJobPayload): Promise<ConvoyageJob> {
  const r = await api.post<{ job: ConvoyageJob }>('/convoyage/jobs', payload);
  return r.data.job;
}

export async function listMyJobs(): Promise<ConvoyageJob[]> {
  const r = await api.get<{ jobs: ConvoyageJob[] }>('/convoyage/jobs/mine');
  return r.data.jobs;
}

export async function getJobProposals(jobId: string): Promise<Proposal[]> {
  const r = await api.get<{ proposals: Proposal[] }>(`/convoyage/jobs/${encodeURIComponent(jobId)}/proposals`);
  return r.data.proposals;
}

export async function acceptProposal(jobId: string, proposalId: string): Promise<void> {
  await api.post(`/convoyage/jobs/${encodeURIComponent(jobId)}/accept`, { proposal_id: proposalId });
}

export async function cancelJob(jobId: string): Promise<void> {
  await api.post(`/convoyage/jobs/${encodeURIComponent(jobId)}/cancel`);
}

export async function browseOpenJobs(): Promise<OpenJob[]> {
  const r = await api.get<{ jobs: OpenJob[] }>('/convoyage/open');
  return r.data.jobs;
}

export async function propose(jobId: string, payload: { price_mru?: number; note?: string }): Promise<void> {
  await api.post(`/convoyage/jobs/${encodeURIComponent(jobId)}/propose`, payload);
}

export async function withdrawProposal(jobId: string): Promise<void> {
  await api.post(`/convoyage/jobs/${encodeURIComponent(jobId)}/withdraw`);
}

export async function listMyProposals(): Promise<MyProposal[]> {
  const r = await api.get<{ proposals: MyProposal[] }>('/convoyage/proposals/mine');
  return r.data.proposals;
}
