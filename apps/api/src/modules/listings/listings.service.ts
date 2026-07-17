import { pool, withTx } from '../../db/pool.js';
import { HttpError } from '../../middleware/error.js';
import { debitWallet } from '../wallet/wallet.service.js';
import { sendNotification } from '../notifications/notifications.service.js';

/**
 * Service listings ("annonces") — a classified-ads marketplace modeled on
 * carpooling. A captain publishes an ad in a category, sets their own price
 * and visibility window, and pays a fixed publication fee from their wallet.
 * Buyers browse by category and reveal the provider's phone to call directly.
 */

export type PriceUnit = 'fixed' | 'per_hour' | 'per_day' | 'per_km' | 'per_trip';
export type ListingStatus = 'active' | 'expired' | 'cancelled';

export interface CategoryConfig {
  category: string;
  label: string;
  enabled: boolean;
  publicationFeeMru: number;
}

export interface PublishListingInput {
  category: string;
  title: string;
  description?: string;
  priceMru: number;
  priceUnit: PriceUnit;
  providerPhone?: string;
  windowDays: number;
}

export interface ListingListItem {
  id: string;
  category: string;
  title: string;
  description: string | null;
  priceMru: number;
  priceUnit: PriceUnit;
  providerName: string;
  publishedUntil: string;
  createdAt: string;
}

export interface ListingDetail extends ListingListItem {
  providerId: string;
  providerPhone?: string;
  publicationFeeMru: number;
  windowDays: number;
  viewsCount: number;
  status: ListingStatus;
}

interface ListingRow {
  id: string;
  provider_id: string;
  category: string;
  title: string;
  description: string | null;
  price_mru: number;
  price_unit: PriceUnit;
  provider_phone: string;
  publication_fee_mru: number;
  window_days: number;
  published_until: Date;
  views_count: number;
  status: ListingStatus;
  created_at: Date;
  provider_name: string | null;
}

function toDetail(row: ListingRow): ListingDetail {
  return {
    id: row.id,
    providerId: row.provider_id,
    category: row.category,
    title: row.title,
    description: row.description,
    priceMru: row.price_mru,
    priceUnit: row.price_unit,
    providerName: row.provider_name ?? 'Prestataire',
    publishedUntil: row.published_until.toISOString(),
    createdAt: row.created_at.toISOString(),
    providerPhone: row.provider_phone,
    publicationFeeMru: row.publication_fee_mru,
    windowDays: row.window_days,
    viewsCount: row.views_count,
    status: row.status,
  };
}

function toListItem(row: ListingRow): ListingListItem {
  return {
    id: row.id,
    category: row.category,
    title: row.title,
    description: row.description,
    priceMru: row.price_mru,
    priceUnit: row.price_unit,
    providerName: row.provider_name ?? 'Prestataire',
    publishedUntil: row.published_until.toISOString(),
    createdAt: row.created_at.toISOString(),
  };
}

const LISTING_COLUMNS = `
  l.id, l.provider_id, l.category, l.title, l.description, l.price_mru,
  l.price_unit, l.provider_phone, l.publication_fee_mru, l.window_days,
  l.published_until, l.views_count, l.status, l.created_at,
  u.full_name AS provider_name`;

export async function listCategories(onlyEnabled = false): Promise<CategoryConfig[]> {
  const where = onlyEnabled ? 'WHERE enabled = true' : '';
  const { rows } = await pool.query<{
    category: string;
    label: string;
    enabled: boolean;
    publication_fee_mru: number;
  }>(
    `SELECT category, label, enabled, publication_fee_mru
       FROM listing_categories ${where}
      ORDER BY category`,
  );
  return rows.map((r) => ({
    category: r.category,
    label: r.label,
    enabled: r.enabled,
    publicationFeeMru: r.publication_fee_mru,
  }));
}

async function getCategoryConfig(category: string): Promise<CategoryConfig | null> {
  const { rows } = await pool.query<{
    category: string;
    label: string;
    enabled: boolean;
    publication_fee_mru: number;
  }>(
    `SELECT category, label, enabled, publication_fee_mru
       FROM listing_categories WHERE category = $1`,
    [category],
  );
  const r = rows[0];
  return r
    ? { category: r.category, label: r.label, enabled: r.enabled, publicationFeeMru: r.publication_fee_mru }
    : null;
}

export async function publishListing(providerId: string, input: PublishListingInput): Promise<ListingDetail> {
  const config = await getCategoryConfig(input.category);
  if (!config) {
    throw new HttpError(400, 'invalid_category', 'Catégorie inconnue');
  }
  if (!config.enabled) {
    throw new HttpError(403, 'category_disabled', 'Cette catégorie est désactivée pour le moment');
  }

  const feeMru = config.publicationFeeMru;

  return withTx(async (client) => {
    const userRes = await client.query<{
      role: 'admin' | 'rider' | 'captain';
      phone: string | null;
      full_name: string | null;
    }>(`SELECT role, phone, full_name FROM users WHERE id = $1`, [providerId]);
    const user = userRes.rows[0];
    if (!user) {
      throw new HttpError(404, 'user_not_found', 'Utilisateur introuvable');
    }
    if (user.role !== 'captain') {
      throw new HttpError(403, 'captain_only', 'Seuls les Captains peuvent publier une annonce');
    }

    const phone = input.providerPhone?.trim() || user.phone;
    if (!phone) {
      throw new HttpError(400, 'provider_phone_required', 'Numéro de téléphone requis');
    }

    if (feeMru > 0) {
      const walletRes = await client.query<{ balance_mru: string }>(
        `SELECT balance_mru FROM wallets WHERE captain_id = $1 FOR UPDATE`,
        [providerId],
      );
      const balanceMru = Number(walletRes.rows[0]?.balance_mru ?? '0');
      if (balanceMru < feeMru) {
        throw new HttpError(402, 'insufficient_wallet', 'Solde insuffisant pour publier');
      }
      await debitWallet({
        captainId: providerId,
        amountMru: feeMru,
        type: 'listing_publication',
        reason: `Publication annonce ${config.label}`,
        createdBy: providerId,
      }, client);
    }

    const inserted = await client.query<ListingRow>(
      `INSERT INTO service_listings (
          provider_id, category, title, description, price_mru, price_unit,
          provider_phone, publication_fee_mru, window_days, published_until
       )
       VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, $9, now() + make_interval(days => $9::integer)
       )
       RETURNING id, provider_id, category, title, description, price_mru,
                 price_unit, provider_phone, publication_fee_mru, window_days,
                 published_until, views_count, status, created_at,
                 $10::text AS provider_name`,
      [
        providerId,
        input.category,
        input.title.trim(),
        input.description?.trim() || null,
        input.priceMru,
        input.priceUnit,
        phone,
        feeMru,
        input.windowDays,
        user.full_name,
      ],
    );

    return toDetail(inserted.rows[0]!);
  });
}

export async function listListings(filters: {
  category?: string;
  search?: string;
  excludeProviderId?: string;
}): Promise<ListingListItem[]> {
  const clauses = [`l.status = 'active'`, `l.published_until > now()`];
  const params: unknown[] = [];

  if (filters.category) {
    params.push(filters.category);
    clauses.push(`l.category = $${params.length}`);
  }
  if (filters.excludeProviderId) {
    params.push(filters.excludeProviderId);
    clauses.push(`l.provider_id <> $${params.length}`);
  }
  if (filters.search?.trim()) {
    params.push(`%${filters.search.trim()}%`);
    clauses.push(`(l.title ILIKE $${params.length} OR l.description ILIKE $${params.length})`);
  }

  const where = `WHERE ${clauses.join(' AND ')}`;
  const { rows } = await pool.query<ListingRow>(
    `SELECT ${LISTING_COLUMNS}
       FROM service_listings l
       JOIN users u ON u.id = l.provider_id
       ${where}
      ORDER BY l.created_at DESC`,
    params,
  );
  return rows.map(toListItem);
}

export async function getListingById(id: string): Promise<ListingDetail | null> {
  const { rows } = await pool.query<ListingRow>(
    `SELECT ${LISTING_COLUMNS}
       FROM service_listings l
       JOIN users u ON u.id = l.provider_id
      WHERE l.id = $1`,
    [id],
  );
  return rows[0] ? toDetail(rows[0]) : null;
}

export async function revealProviderContact(listingId: string, viewerId: string): Promise<{
  providerPhone: string;
  providerName: string;
}> {
  const { rows } = await pool.query<{
    provider_id: string;
    provider_phone: string;
    provider_name: string | null;
    title: string;
    status: ListingStatus;
    published_until: Date;
  }>(
    `UPDATE service_listings l
        SET views_count = views_count + 1
       FROM users u
      WHERE l.id = $1
        AND l.provider_id = u.id
      RETURNING l.provider_id, l.provider_phone, u.full_name AS provider_name,
                l.title, l.status, l.published_until`,
    [listingId],
  );
  const row = rows[0];
  if (!row) {
    throw new HttpError(404, 'listing_not_found', 'Annonce introuvable');
  }
  if (row.status !== 'active' || row.published_until.getTime() < Date.now()) {
    throw new HttpError(410, 'listing_inactive', 'Cette annonce n\'est plus disponible');
  }

  if (viewerId !== row.provider_id) {
    void sendNotification({
      target: { type: 'user', userId: row.provider_id },
      title: 'Nouveau contact annonce',
      body: `Quelqu'un s'intéresse à votre annonce « ${row.title} ».`,
      type: 'info',
      data: { feature: 'listings', listingId },
      sentBy: null,
    }).catch(() => {});
  }

  return {
    providerPhone: row.provider_phone,
    providerName: row.provider_name ?? 'Prestataire',
  };
}

export async function listMyListings(providerId: string): Promise<ListingDetail[]> {
  const { rows } = await pool.query<ListingRow>(
    `SELECT ${LISTING_COLUMNS}
       FROM service_listings l
       JOIN users u ON u.id = l.provider_id
      WHERE l.provider_id = $1
      ORDER BY l.created_at DESC`,
    [providerId],
  );
  return rows.map(toDetail);
}

export async function cancelMyListing(listingId: string, providerId: string): Promise<boolean> {
  const r = await pool.query(
    `UPDATE service_listings
        SET status = 'cancelled'
      WHERE id = $1 AND provider_id = $2 AND status <> 'cancelled'`,
    [listingId, providerId],
  );
  return (r.rowCount ?? 0) > 0;
}

// --- Admin ---

export async function listAdminListings(limit = 500): Promise<Array<ListingDetail>> {
  const { rows } = await pool.query<ListingRow>(
    `SELECT ${LISTING_COLUMNS}
       FROM service_listings l
       JOIN users u ON u.id = l.provider_id
      ORDER BY l.created_at DESC
      LIMIT $1`,
    [limit],
  );
  return rows.map(toDetail);
}

export async function getAdminStats(): Promise<{
  totalListings: number;
  activeListings: number;
  totalRevenueMru: number;
  avgViews: number;
}> {
  const { rows } = await pool.query<{
    total_listings: string;
    active_listings: string;
    total_revenue_mru: string;
    avg_views: string;
  }>(
    `SELECT COUNT(*)::text AS total_listings,
            COUNT(*) FILTER (WHERE status = 'active' AND published_until > now())::text AS active_listings,
            COALESCE(SUM(publication_fee_mru), 0)::text AS total_revenue_mru,
            COALESCE(AVG(views_count), 0)::text AS avg_views
       FROM service_listings`,
  );
  const row = rows[0];
  return {
    totalListings: Number(row?.total_listings ?? 0),
    activeListings: Number(row?.active_listings ?? 0),
    totalRevenueMru: Number(row?.total_revenue_mru ?? 0),
    avgViews: Number(row?.avg_views ?? 0),
  };
}

export async function updateCategory(
  category: string,
  patch: { enabled?: boolean; publicationFeeMru?: number },
): Promise<CategoryConfig> {
  const { rows } = await pool.query<{
    category: string;
    label: string;
    enabled: boolean;
    publication_fee_mru: number;
  }>(
    `UPDATE listing_categories
        SET enabled = COALESCE($2, enabled),
            publication_fee_mru = COALESCE($3, publication_fee_mru)
      WHERE category = $1
      RETURNING category, label, enabled, publication_fee_mru`,
    [category, patch.enabled ?? null, patch.publicationFeeMru ?? null],
  );
  if (!rows[0]) {
    throw new HttpError(404, 'category_not_found', 'Catégorie introuvable');
  }
  return {
    category: rows[0].category,
    label: rows[0].label,
    enabled: rows[0].enabled,
    publicationFeeMru: rows[0].publication_fee_mru,
  };
}

export async function expireListings(): Promise<number> {
  const { rowCount } = await pool.query(
    `UPDATE service_listings
        SET status = 'expired'
      WHERE status = 'active'
        AND published_until < now()`,
  );
  return rowCount ?? 0;
}

const CRON_INTERVAL_MS = 60 * 60 * 1000;

export function startListingsCron() {
  const tick = async () => {
    try {
      const expired = await expireListings();
      if (expired > 0) {
        // eslint-disable-next-line no-console
        console.log(`[listings] expired=${expired}`);
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[listings] cron tick failed', err);
    }
  };
  setTimeout(tick, 25_000);
  setInterval(tick, CRON_INTERVAL_MS).unref();
}
