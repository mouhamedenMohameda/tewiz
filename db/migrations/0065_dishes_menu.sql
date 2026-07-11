-- Structured restaurant menus: a shared dish catalog ("chips") + per-restaurant
-- menu items carrying the price. This replaces the photo-based "carte des plats"
-- as the way a collector describes what a restaurant serves.
--
--   dishes                 — global, reusable catalog. Each row is one "chip"
--                            the collector can click. Deduplicated by a
--                            normalized name so "Pizza" / "pizza " collapse.
--   restaurant_menu_items  — the menu of one restaurant = (dish + price_mru).
--                            The price lives here because it belongs to the
--                            restaurant×dish pair, not to the dish itself.

BEGIN;

CREATE TABLE IF NOT EXISTS dishes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Arabic name is primary (the collection source is Arabic); French optional.
  name_ar         text NOT NULL,
  name_fr         text,
  -- Lowercased, accent-stripped, single-spaced key used for dedup + search.
  normalized_name text NOT NULL,
  -- Optional grouping, mirrors the source app's tabs
  -- ('boissons' | 'fast_food' | 'plats' | 'desserts' | …).
  category        text,
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- One chip per normalized name — this is what makes clicking add an existing
-- dish instead of creating a duplicate.
CREATE UNIQUE INDEX IF NOT EXISTS dishes_normalized_name_key ON dishes (normalized_name);
CREATE INDEX IF NOT EXISTS dishes_category_idx ON dishes (category);
-- Fuzzy search for the chip search box.
CREATE INDEX IF NOT EXISTS dishes_name_trgm_idx ON dishes USING gin (normalized_name gin_trgm_ops);

CREATE TABLE IF NOT EXISTS restaurant_menu_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id   text NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  dish_id         uuid NOT NULL REFERENCES dishes(id) ON DELETE CASCADE,
  price_mru       integer NOT NULL CHECK (price_mru >= 0),
  sort_order      integer NOT NULL DEFAULT 0,
  is_available    boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- A dish appears at most once in a given restaurant's menu.
  CONSTRAINT restaurant_menu_items_uniq UNIQUE (restaurant_id, dish_id)
);

CREATE INDEX IF NOT EXISTS restaurant_menu_items_restaurant_idx
  ON restaurant_menu_items (restaurant_id, sort_order);
CREATE INDEX IF NOT EXISTS restaurant_menu_items_dish_idx
  ON restaurant_menu_items (dish_id);

COMMIT;
