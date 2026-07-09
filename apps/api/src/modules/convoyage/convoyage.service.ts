import { pool, withTx } from '../../db/pool.js';
import { HttpError } from '../../middleware/error.js';
import { sendNotification } from '../notifications/notifications.service.js';

/**
 * Convoyage — a job board. A client posts a job (drive my vehicle A→B on a
 * date); convoyeurs browse open jobs and submit a proposal (optional price +
 * note). The client reviews proposals (with each convoyeur's rating) and PICKS
 * one; on selection the two phone numbers are revealed and the job is assigned.
 */

export type JobStatus = 'open' | 'assigned' | 'completed' | 'cancelled' | 'expired';
export type ProposalStatus = 'pending' | 'accepted' | 'rejected' | 'withdrawn';

export interface CreateJobInput {
  pickupLat?: number;
  pickupLng?: number;
  pickupLabel: string;
  dropoffLabel: string;
  vehiclePlate: string;
  vehicleModel?: string;
  desiredDate?: string;
  note?: string;
}

export interface JobDTO {
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

export interface ProposalDTO {
  id: string;
  providerName: string;
  providerRating: number | null;
  priceMru: number | null;
  note: string | null;
  status: ProposalStatus;
  createdAt: string;
}

export interface OpenJobDTO {
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

export interface MyProposalDTO {
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

// --- Client: jobs ---

export async function createJob(clientId: string, input: CreateJobInput): Promise<JobDTO> {
  const { rows } = await pool.query<{ id: string; created_at: Date }>(
    `INSERT INTO convoyage_jobs (
       client_id, pickup_location, pickup_label, dropoff_label,
       vehicle_plate, vehicle_model, desired_date, note
     )
     VALUES (
       $1,
       CASE WHEN $2::float8 IS NULL THEN NULL
            ELSE ST_SetSRID(ST_MakePoint($3,$2),4326)::geography END,
       $4, $5, $6, $7, $8, $9
     )
     RETURNING id, created_at`,
    [
      clientId, input.pickupLat ?? null, input.pickupLng ?? null,
      input.pickupLabel.trim(), input.dropoffLabel.trim(),
      input.vehiclePlate.trim(), input.vehicleModel?.trim() || null,
      input.desiredDate ?? null, input.note?.trim() || null,
    ],
  );
  return (await getJobById(rows[0]!.id, clientId))!;
}

type JobRow = {
  id: string; pickup_label: string; dropoff_label: string; vehicle_plate: string;
  vehicle_model: string | null; desired_date: Date | null; note: string | null;
  status: JobStatus; created_at: Date; proposal_count: string;
  provider_name: string | null; provider_phone: string | null; provider_rating: string | null;
};

const JOB_SELECT = `
  SELECT j.id, j.pickup_label, j.dropoff_label, j.vehicle_plate, j.vehicle_model,
         j.desired_date, j.note, j.status, j.created_at,
         (SELECT COUNT(*) FROM convoyage_proposals p
           WHERE p.job_id = j.id AND p.status IN ('pending','accepted'))::text AS proposal_count,
         pu.full_name AS provider_name,
         CASE WHEN j.status IN ('assigned','completed') THEN pu.phone ELSE NULL END AS provider_phone,
         pc.rating_avg AS provider_rating
    FROM convoyage_jobs j
    LEFT JOIN users pu ON pu.id = j.assigned_provider_id
    LEFT JOIN captains pc ON pc.user_id = j.assigned_provider_id`;

function toJobDTO(r: JobRow): JobDTO {
  return {
    id: r.id,
    pickupLabel: r.pickup_label,
    dropoffLabel: r.dropoff_label,
    vehiclePlate: r.vehicle_plate,
    vehicleModel: r.vehicle_model,
    desiredDate: r.desired_date ? r.desired_date.toISOString().slice(0, 10) : null,
    note: r.note,
    status: r.status,
    proposalCount: Number(r.proposal_count),
    provider: r.provider_phone
      ? { name: r.provider_name ?? 'Convoyeur', phone: r.provider_phone, ratingAvg: r.provider_rating != null ? Number(r.provider_rating) : null }
      : null,
    createdAt: r.created_at.toISOString(),
  };
}

async function getJobById(id: string, clientId: string): Promise<JobDTO | null> {
  const { rows } = await pool.query<JobRow>(
    `${JOB_SELECT} WHERE j.id = $1 AND j.client_id = $2`,
    [id, clientId],
  );
  return rows[0] ? toJobDTO(rows[0]) : null;
}

export async function listMyJobs(clientId: string): Promise<JobDTO[]> {
  const { rows } = await pool.query<JobRow>(
    `${JOB_SELECT} WHERE j.client_id = $1 ORDER BY j.created_at DESC`,
    [clientId],
  );
  return rows.map(toJobDTO);
}

export async function getJobProposals(jobId: string, clientId: string): Promise<ProposalDTO[]> {
  const owns = await pool.query(`SELECT 1 FROM convoyage_jobs WHERE id = $1 AND client_id = $2`, [jobId, clientId]);
  if (!owns.rows[0]) throw new HttpError(404, 'job_not_found', 'Demande introuvable');

  const { rows } = await pool.query<{
    id: string; price_mru: number | null; note: string | null; status: ProposalStatus;
    created_at: Date; provider_name: string | null; provider_rating: string | null;
  }>(
    `SELECT p.id, p.price_mru, p.note, p.status, p.created_at,
            u.full_name AS provider_name, c.rating_avg AS provider_rating
       FROM convoyage_proposals p
       JOIN users u ON u.id = p.provider_id
       LEFT JOIN captains c ON c.user_id = p.provider_id
      WHERE p.job_id = $1 AND p.status IN ('pending','accepted')
      ORDER BY p.created_at ASC`,
    [jobId],
  );
  return rows.map((r) => ({
    id: r.id,
    providerName: r.provider_name ?? 'Convoyeur',
    providerRating: r.provider_rating != null ? Number(r.provider_rating) : null,
    priceMru: r.price_mru,
    note: r.note,
    status: r.status,
    createdAt: r.created_at.toISOString(),
  }));
}

export async function acceptProposal(jobId: string, proposalId: string, clientId: string): Promise<void> {
  await withTx(async (client) => {
    const job = await client.query<{ status: JobStatus }>(
      `SELECT status FROM convoyage_jobs WHERE id = $1 AND client_id = $2 FOR UPDATE`,
      [jobId, clientId],
    );
    if (!job.rows[0]) throw new HttpError(404, 'job_not_found', 'Demande introuvable');
    if (job.rows[0].status !== 'open') throw new HttpError(409, 'not_open', 'Cette demande est déjà attribuée ou fermée');

    const prop = await client.query<{ provider_id: string }>(
      `SELECT provider_id FROM convoyage_proposals WHERE id = $1 AND job_id = $2 AND status = 'pending'`,
      [proposalId, jobId],
    );
    if (!prop.rows[0]) throw new HttpError(404, 'proposal_not_found', 'Proposition introuvable');
    const providerId = prop.rows[0].provider_id;

    await client.query(`UPDATE convoyage_proposals SET status = 'accepted' WHERE id = $1`, [proposalId]);
    await client.query(
      `UPDATE convoyage_proposals SET status = 'rejected' WHERE job_id = $1 AND id <> $2 AND status = 'pending'`,
      [jobId, proposalId],
    );
    await client.query(
      `UPDATE convoyage_jobs SET status = 'assigned', assigned_provider_id = $2, assigned_at = now() WHERE id = $1`,
      [jobId, providerId],
    );

    void sendNotification({
      target: { type: 'user', userId: providerId },
      title: 'Convoyage : vous avez été choisi ✅',
      body: 'Le client a retenu votre proposition. Retrouvez son numéro dans « Mes propositions ».',
      type: 'info',
      data: { feature: 'convoyage', jobId },
      sentBy: null,
    }).catch(() => {});
  });
}

export async function cancelJob(jobId: string, clientId: string): Promise<boolean> {
  const r = await pool.query(
    `UPDATE convoyage_jobs SET status = 'cancelled'
      WHERE id = $1 AND client_id = $2 AND status IN ('open','assigned')`,
    [jobId, clientId],
  );
  return (r.rowCount ?? 0) > 0;
}

// --- Provider: browse + propose ---

export async function browseOpenJobs(providerId: string): Promise<OpenJobDTO[]> {
  const { rows } = await pool.query<{
    id: string; pickup_label: string; dropoff_label: string; vehicle_model: string | null;
    desired_date: Date | null; note: string | null; created_at: Date; client_name: string | null;
    proposal_count: string; already_proposed: boolean;
  }>(
    `SELECT j.id, j.pickup_label, j.dropoff_label, j.vehicle_model, j.desired_date, j.note, j.created_at,
            u.full_name AS client_name,
            (SELECT COUNT(*) FROM convoyage_proposals p WHERE p.job_id = j.id AND p.status = 'pending')::text AS proposal_count,
            EXISTS (SELECT 1 FROM convoyage_proposals p2 WHERE p2.job_id = j.id AND p2.provider_id = $1 AND p2.status IN ('pending','accepted')) AS already_proposed
       FROM convoyage_jobs j
       JOIN users u ON u.id = j.client_id
      WHERE j.status = 'open' AND j.client_id <> $1
      ORDER BY j.created_at DESC
      LIMIT 100`,
    [providerId],
  );
  return rows.map((r) => ({
    id: r.id,
    pickupLabel: r.pickup_label,
    dropoffLabel: r.dropoff_label,
    vehicleModel: r.vehicle_model,
    desiredDate: r.desired_date ? r.desired_date.toISOString().slice(0, 10) : null,
    note: r.note,
    clientName: r.client_name ?? 'Client',
    proposalCount: Number(r.proposal_count),
    alreadyProposed: r.already_proposed,
    createdAt: r.created_at.toISOString(),
  }));
}

export async function propose(jobId: string, providerId: string, input: { priceMru?: number; note?: string }): Promise<void> {
  const job = await pool.query<{ client_id: string; status: JobStatus }>(
    `SELECT client_id, status FROM convoyage_jobs WHERE id = $1`, [jobId],
  );
  const j = job.rows[0];
  if (!j || j.status !== 'open') throw new HttpError(404, 'job_unavailable', 'Cette demande n\'est plus ouverte');
  if (j.client_id === providerId) throw new HttpError(400, 'own_job', 'Vous ne pouvez pas vous proposer sur votre propre demande');

  const r = await pool.query(
    `INSERT INTO convoyage_proposals (job_id, provider_id, price_mru, note)
     VALUES ($1,$2,$3,$4)
     ON CONFLICT (job_id, provider_id) DO UPDATE
       SET price_mru = EXCLUDED.price_mru, note = EXCLUDED.note, status = 'pending', created_at = now()`,
    [jobId, providerId, input.priceMru ?? null, input.note?.trim() || null],
  );
  if ((r.rowCount ?? 0) > 0) {
    void sendNotification({
      target: { type: 'user', userId: j.client_id },
      title: 'Convoyage : nouvelle proposition',
      body: 'Un convoyeur s\'est proposé pour votre demande.',
      type: 'info',
      data: { feature: 'convoyage', jobId },
      sentBy: null,
    }).catch(() => {});
  }
}

export async function withdrawProposal(jobId: string, providerId: string): Promise<boolean> {
  const r = await pool.query(
    `UPDATE convoyage_proposals SET status = 'withdrawn'
      WHERE job_id = $1 AND provider_id = $2 AND status = 'pending'`,
    [jobId, providerId],
  );
  return (r.rowCount ?? 0) > 0;
}

export async function listMyProposals(providerId: string): Promise<MyProposalDTO[]> {
  const { rows } = await pool.query<{
    id: string; job_id: string; pickup_label: string; dropoff_label: string;
    price_mru: number | null; note: string | null; status: ProposalStatus; created_at: Date;
    job_status: JobStatus; client_name: string | null; client_phone: string | null;
  }>(
    `SELECT p.id, p.job_id, j.pickup_label, j.dropoff_label, p.price_mru, p.note, p.status, p.created_at,
            j.status AS job_status, u.full_name AS client_name,
            CASE WHEN p.status = 'accepted' THEN u.phone ELSE NULL END AS client_phone
       FROM convoyage_proposals p
       JOIN convoyage_jobs j ON j.id = p.job_id
       JOIN users u ON u.id = j.client_id
      WHERE p.provider_id = $1 AND p.status <> 'withdrawn'
      ORDER BY p.created_at DESC`,
    [providerId],
  );
  return rows.map((r) => ({
    id: r.id,
    jobId: r.job_id,
    pickupLabel: r.pickup_label,
    dropoffLabel: r.dropoff_label,
    priceMru: r.price_mru,
    note: r.note,
    status: r.status,
    jobStatus: r.job_status,
    clientName: r.client_name ?? 'Client',
    clientPhone: r.client_phone,
    createdAt: r.created_at.toISOString(),
  }));
}
