import { latLngToCell, cellToLatLng } from 'h3-js';
import { pool } from '../../db/pool.js';

const H3_RESOLUTION = 9;  // ~170 m hexagons — Nouakchott-sized cells
const WINDOW_MINUTES = 30;

/**
 * Recompute the demand heatmap based on rides requested in the last
 * WINDOW_MINUTES. Replaces the demand_heatmap snapshot entirely.
 *
 * Designed to be called every 5 minutes by cron.
 */
export async function compute() {
  // Fetch recent ride pickup coordinates.
  const r = await pool.query<{ lat: number; lng: number }>(
    `SELECT ST_Y(pickup_location::geometry) AS lat,
            ST_X(pickup_location::geometry) AS lng
       FROM rides
      WHERE requested_at > now() - ($1 || ' minutes')::interval`,
    [WINDOW_MINUTES.toString()],
  );

  // Aggregate by H3 cell.
  const counts = new Map<string, number>();
  for (const row of r.rows) {
    const cell = latLngToCell(Number(row.lat), Number(row.lng), H3_RESOLUTION);
    counts.set(cell, (counts.get(cell) ?? 0) + 1);
  }
  const max = Math.max(1, ...counts.values());

  // Replace snapshot atomically.
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM demand_heatmap');
    for (const [cell, count] of counts) {
      const [lat, lng] = cellToLatLng(cell);
      await client.query(
        `INSERT INTO demand_heatmap (h3_index, centroid, demand_score, ride_count_30m)
         VALUES ($1, ST_SetSRID(ST_MakePoint($2, $3), 4326)::geography, $4, $5)`,
        [cell, lng, lat, count / max, count],
      );
    }
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }

  return { cells: counts.size, recentRides: r.rowCount ?? 0 };
}

interface ListInput {
  minLat?: number;
  maxLat?: number;
  minLng?: number;
  maxLng?: number;
  limit?: number;
}

export async function listCells(input: ListInput = {}) {
  let sql = `
    SELECT h3_index,
           ST_Y(centroid::geometry) AS lat,
           ST_X(centroid::geometry) AS lng,
           demand_score, ride_count_30m, computed_at
      FROM demand_heatmap
  `;
  const params: unknown[] = [];
  const wheres: string[] = [];
  if (input.minLat !== undefined && input.maxLat !== undefined
      && input.minLng !== undefined && input.maxLng !== undefined) {
    params.push(input.minLng, input.minLat, input.maxLng, input.maxLat);
    wheres.push(`centroid && ST_MakeEnvelope($1, $2, $3, $4, 4326)::geography`);
  }
  if (wheres.length) sql += ' WHERE ' + wheres.join(' AND ');
  sql += ' ORDER BY demand_score DESC';
  params.push(input.limit ?? 500);
  sql += ` LIMIT $${params.length}`;
  const r = await pool.query(sql, params);
  return r.rows.map((row) => ({
    h3Index: row.h3_index,
    centroid: { lat: row.lat, lng: row.lng },
    demandScore: row.demand_score,
    rideCount30m: row.ride_count_30m,
    computedAt: row.computed_at,
  }));
}
