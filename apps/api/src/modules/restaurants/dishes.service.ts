/**
 * Dish catalog ("chips") + per-restaurant menu.
 *
 *   dishes                 — global, deduplicated list of dishes. Powers the
 *                            searchable chips in the admin menu builder.
 *   restaurant_menu_items  — the menu of one restaurant: (dish + price_mru).
 *
 * All SQL touching those two tables lives here so the row → DTO mapping stays
 * consistent between the admin builder and the rider read endpoints.
 */

import type { PoolClient } from 'pg';
import { pool } from '../../db/pool.js';

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

/** A catalog dish (one chip). `usageCount` = number of restaurants using it. */
export interface DishDto {
  id: string;
  nameAr: string;
  nameFr: string | null;
  category: string | null;
  usageCount: number;
}

/** A single line of a restaurant's menu. */
export interface MenuItemDto {
  id: string;
  dishId: string;
  nameAr: string;
  nameFr: string | null;
  category: string | null;
  priceMru: number;
  sortOrder: number;
  isAvailable: boolean;
}

interface DishRow {
  id: string;
  name_ar: string;
  name_fr: string | null;
  category: string | null;
  usage_count?: string | number;
}

interface MenuItemRow {
  id: string;
  dish_id: string;
  name_ar: string;
  name_fr: string | null;
  category: string | null;
  price_mru: number;
  sort_order: number;
  is_available: boolean;
}

function toDishDto(r: DishRow): DishDto {
  return {
    id: r.id,
    nameAr: r.name_ar,
    nameFr: r.name_fr,
    category: r.category,
    usageCount: r.usage_count == null ? 0 : Number(r.usage_count),
  };
}

function toMenuItemDto(r: MenuItemRow): MenuItemDto {
  return {
    id: r.id,
    dishId: r.dish_id,
    nameAr: r.name_ar,
    nameFr: r.name_fr,
    category: r.category,
    priceMru: r.price_mru,
    sortOrder: r.sort_order,
    isAvailable: r.is_available,
  };
}

// ---------------------------------------------------------------------------
// Normalization — dedup key + search
// ---------------------------------------------------------------------------

/**
 * Lowercase, strip Latin diacritics, collapse whitespace. Arabic text is left
 * intact apart from spacing. This is the key used both for uniqueness (one chip
 * per dish) and for the search box.
 */
export function normalizeDishName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '') // strip Latin combining marks
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// Dish catalog
// ---------------------------------------------------------------------------

export interface ListDishesOptions {
  search?: string;
  limit?: number;
}

export async function listDishes(opts: ListDishesOptions = {}): Promise<DishDto[]> {
  const params: unknown[] = [];
  let where = '';
  if (opts.search?.trim()) {
    params.push(`%${normalizeDishName(opts.search)}%`);
    where = `WHERE d.normalized_name LIKE $${params.length}`;
  }
  const limit = Math.min(Math.max(opts.limit ?? 500, 1), 1000);
  params.push(limit);

  const { rows } = await pool.query<DishRow>(
    `SELECT d.id, d.name_ar, d.name_fr, d.category,
            count(m.id) AS usage_count
       FROM dishes d
       LEFT JOIN restaurant_menu_items m ON m.dish_id = d.id
       ${where}
       GROUP BY d.id
       ORDER BY count(m.id) DESC, d.name_ar ASC
       LIMIT $${params.length}`,
    params,
  );
  return rows.map(toDishDto);
}

export interface CreateDishInput {
  nameAr: string;
  nameFr?: string | null;
  category?: string | null;
}

/**
 * Create a dish, or return the existing one when its normalized name already
 * exists (so clicking "create" twice never duplicates a chip). The insert uses
 * ON CONFLICT on the normalized_name unique index.
 */
export async function createDish(
  input: CreateDishInput,
  actorId: string | null,
  client?: PoolClient,
): Promise<DishDto> {
  const exec = client ?? pool;
  const normalized = normalizeDishName(input.nameAr);

  const { rows } = await exec.query<DishRow>(
    `INSERT INTO dishes (name_ar, name_fr, normalized_name, category, created_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (normalized_name) DO UPDATE SET
       -- keep the existing row; fill French / category only if newly provided
       name_fr   = COALESCE(dishes.name_fr, EXCLUDED.name_fr),
       category  = COALESCE(dishes.category, EXCLUDED.category),
       updated_at = now()
     RETURNING id, name_ar, name_fr, category`,
    [input.nameAr.trim(), input.nameFr?.trim() || null, normalized, input.category?.trim() || null, actorId],
  );
  return toDishDto(rows[0]!);
}

// ---------------------------------------------------------------------------
// Restaurant menu
// ---------------------------------------------------------------------------

export async function getRestaurantMenu(
  restaurantId: string,
  client?: PoolClient,
): Promise<MenuItemDto[]> {
  const exec = client ?? pool;
  const { rows } = await exec.query<MenuItemRow>(
    `SELECT m.id, m.dish_id, d.name_ar, d.name_fr, d.category,
            m.price_mru, m.sort_order, m.is_available
       FROM restaurant_menu_items m
       JOIN dishes d ON d.id = m.dish_id
      WHERE m.restaurant_id = $1
      ORDER BY m.sort_order ASC, d.name_ar ASC`,
    [restaurantId],
  );
  return rows.map(toMenuItemDto);
}

export interface MenuItemInput {
  dishId: string;
  priceMru: number;
  sortOrder?: number;
  isAvailable?: boolean;
}

/**
 * Replace a restaurant's whole menu with `items` (the admin builder saves the
 * full list at once). Runs in a transaction: delete lines no longer present,
 * then upsert the current ones. Returns the fresh menu.
 */
export async function setRestaurantMenu(
  restaurantId: string,
  items: MenuItemInput[],
  client: PoolClient,
): Promise<MenuItemDto[]> {
  const dishIds = items.map((i) => i.dishId);

  // Drop lines whose dish is no longer in the submitted list.
  await client.query(
    `DELETE FROM restaurant_menu_items
      WHERE restaurant_id = $1
        AND ($2::uuid[] = '{}' OR dish_id <> ALL($2::uuid[]))`,
    [restaurantId, dishIds],
  );

  // Upsert each remaining line, keeping the submitted order.
  for (let i = 0; i < items.length; i++) {
    const it = items[i]!;
    await client.query(
      `INSERT INTO restaurant_menu_items
         (restaurant_id, dish_id, price_mru, sort_order, is_available)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (restaurant_id, dish_id) DO UPDATE SET
         price_mru    = EXCLUDED.price_mru,
         sort_order   = EXCLUDED.sort_order,
         is_available = EXCLUDED.is_available,
         updated_at   = now()`,
      [restaurantId, it.dishId, Math.round(it.priceMru), it.sortOrder ?? i, it.isAvailable ?? true],
    );
  }

  return getRestaurantMenu(restaurantId, client);
}
