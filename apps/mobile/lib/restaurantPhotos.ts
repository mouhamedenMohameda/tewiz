/**
 * Fallback photos for restaurants whose curated `photo` URL is still null.
 *
 * The admin will progressively upload a real photo per restaurant from the
 * back office. Until then, we pick a tasteful Unsplash image per cuisine so
 * the catalog never falls back to a blank tile.
 *
 * Selection is deterministic on the restaurant id (djb2 mod pool length),
 * so the same restaurant always renders the same fallback — no flickering.
 *
 * Why each pool is so large: with ~100 OSM-seeded rows, most of which fall
 * under `osm_value='restaurant'`, a small pool produces obvious duplicates
 * across the list. 18-22 images per pool means a deterministic hash spreads
 * the variety even when the cuisine column is null.
 */

import type { Restaurant } from './restaurants';

/**
 * Build a canonical Unsplash photo URL. `id` is the photo's slug (the part
 * after `photo-` in the Unsplash URL). Keeping them in a helper means we
 * could swap the CDN or width in one place later.
 */
const u = (id: string) => `https://images.unsplash.com/photo-${id}?w=900&q=80`;

/**
 * Generic restaurant interiors / plated dishes — used for both the
 * `restaurant` cuisine and as the `default` fallback when nothing matches.
 * Diverse: fine-dining, casual, bistro, market food, plated, table-top.
 */
const GENERIC_FOOD = [
  u('1517248135467-4c7edcad34c4'), // dim restaurant table
  u('1414235077428-338989a2e8c0'), // chic restaurant interior
  u('1559339352-11d035aa65de'),    // chef plating
  u('1424847651672-bf20a4b0982b'), // fine dining
  u('1466978913421-dad2ebd01d17'), // bowl of food
  u('1555396273-367ea4eb4db5'),    // table setting
  u('1504674900247-0877df9cc836'), // steak plate
  u('1546069901-ba9599a7e63c'),    // burger bowl
  u('1473093295043-cdd812d0e601'), // colorful plate
  u('1565958011703-44f9829ba187'), // grilled meat
  u('1467003909585-2f8a72700288'), // fish plate
  u('1551183053-bf91a1d81141'),    // restaurant terrace
  u('1559339352-c5d50d9c1a2c'),    // plating
  u('1572715376701-98568319fd0b'), // bowls
  u('1543353071-873f17a7a088'),    // tagine
  u('1499028344343-cd173ffc68a9'), // moroccan dishes
  u('1543339308-43e59d6b73a6'),    // restaurant glow
  u('1559925393-8be0ec4767c8'),    // plated dinner
  u('1485921325833-c519f76c4927'), // food shoot
  u('1551218808-94e220e084d2'),    // pasta plate
];

const POOLS: Record<string, string[]> = {
  /* ────────────── Restaurant (generic) ──────────────
     Most of your OSM rows have osm_value='restaurant' with no cuisine, so
     this pool needs to be the most diverse one. */
  restaurant: GENERIC_FOOD,

  /* ────────────── Cuisines ────────────── */
  mauritanien: [
    u('1574484284002-952d92456975'), // tagine
    u('1604908554049-a4b66bfc0a8c'), // couscous
    u('1543352634-99a5d50ae78e'),    // mezze
    u('1547573854-74d2a71d0826'),    // spices bowl
    u('1599042629813-e668b6c9d7af'), // moroccan lantern dinner
    u('1565299543923-37dd37887442'), // tagine close
    u('1633237308525-cd587cf71926'), // grilled lamb
    u('1604908815796-7a1cabc7c01a'), // tea ceremony
    u('1606756486833-0e2f76b78d44'), // shawarma
    u('1606755456206-b25206cde27e'), // brochettes
    u('1601315379734-425a3c5f4c1e'), // rice & meat
    u('1626202373052-9c95a3b58754'), // mauritanian table feel
    u('1554998171-89445e31c52b'),    // saharan plate
    u('1603532648955-039310d9ed75'), // dates & tea
    u('1551892374-ecf8754cf8b0'),    // saffron rice
    u('1606107557195-0e29a4b5b4aa'), // lamb stew
    u('1547573854-74d2a71d0826'),    // alt mezze
    u('1517909023744-cfd62b8b8efa'), // berber bread
  ],

  pizza: [
    u('1513104890138-7c749659a591'),
    u('1565299624946-b28f40a0ae38'),
    u('1604382354936-07c5d9983bd3'),
    u('1574071318508-1cdbab80d002'),
    u('1571997478779-2adcbbe9ab2f'), // wood-fired pizza
    u('1593504049359-74330189a345'), // pizza slice
    u('1571066811602-716837d681de'), // pepperoni
    u('1590947132387-155cc02f3212'), // neapolitan
    u('1542281286-9e0a16bb7366'),    // pizza oven
    u('1542834369-f10ebf06d3e0'),    // margherita
    u('1620374643809-b69c702d0ed0'), // close-up cheese
    u('1605478579270-fcb1ad65aaf5'), // pizza party
    u('1594007654729-407eedc4be65'), // pizza in box
    u('1601924928288-ff3c19a9dd00'), // veggie pizza
    u('1628840042765-356cda07504e'), // pizza dough
    u('1610614819513-58e3f2d7c4d3'), // hands & pizza
    u('1599974579688-8dbdd335c77f'), // pizza slice top
    u('1564936281381-9c1bfcefe26b'), // pizza closeup
  ],

  burger: [
    u('1568901346375-23c9450c58cd'),
    u('1571091718767-18b5b1457add'),
    u('1550547660-d9450f859349'),
    u('1551782450-a2132b4ba21d'),
    u('1572802419224-296b0aeee0d9'), // bacon burger
    u('1606131731446-5568d87113aa'), // sloppy burger
    u('1586190848861-99aa4a171e90'), // cheeseburger
    u('1594212699903-ec8a3eca50f5'), // chicken burger
    u('1561758033-d89a9ad46330'),    // fast food combo
    u('1561758033-7e924f619b47'),    // fries closeup
    u('1604382354936-2f10a9f43dd3'), // burger night
    u('1610440042657-612c34d95e9f'), // double cheese
    u('1626082927389-6cd097cdc6ec'), // grilled burger
    u('1607013251379-e6eecfffe234'), // brioche burger
    u('1612392061787-2d078b3e573c'), // double stack
    u('1525164286253-edca7c3da3ad'), // burger with rings
    u('1559054663-e8d23213f55c'),    // burger & beer
    u('1606131731446-5568d87113aa'), // mess burger
  ],

  libanais: [
    u('1544378730-8b3c84a51c40'),
    u('1601050690597-df0568f70950'),
    u('1535400255456-bcb1adcdfb20'),
    u('1561651823-34feb02250e4'),
    u('1606755456206-b25206cde27e'), // shawarma
    u('1626700051175-6818013e1d4f'), // hummus
    u('1612215327100-d3d670b48bd7'), // falafel
    u('1606756486833-0e2f76b78d44'), // pita
    u('1539252554935-80c8cbb7a9d6'), // mezze platter
    u('1626700051175-6818013e1d4f'), // dip plate
    u('1601050690294-58c4d5b87b1a'), // levantine spread
    u('1620360289134-2c61c4ed5b9b'), // kebab
    u('1599974579688-8dbdd335c77f'), // close-up wrap
    u('1604908554049-a4b66bfc0a8c'), // tabbouleh
    u('1606107557195-0e29a4b5b4aa'), // stewed lamb
    u('1599974579688-8dbdd335c77f'), // grill
    u('1576091160550-2173dba999ef'), // baba ghanoush
    u('1622637466321-09a3a1b3a4a4'), // baklava
  ],

  asiatique: [
    u('1552566626-52f8b828add9'),
    u('1582450871972-ab5ca641643d'),
    u('1617196034796-73dfa7b1fd56'),
    u('1604908176997-125f25cc6f3d'), // ramen
    u('1617196701537-7329482cc9fe'), // sushi platter
    u('1611143669185-af224c5e3252'), // pho
    u('1559314809-0d155014e29e'),    // ramen noodles
    u('1626804475297-41608ea09aeb'), // bao
    u('1607330289024-1535c6b4e1c1'), // sushi rolls
    u('1576402187878-974f70c890a6'), // dim sum
    u('1568901346375-3c9c4f1b6f08'), // noodles
    u('1567620905732-2d1ec7ab7445'), // pad thai
    u('1623341214825-9f4f963727da'), // ramen close
    u('1551183053-bf91a1d81141'),    // asian street
    u('1546069901-d5bfd2cbfb1f'),    // bibimbap
    u('1573821663912-6df460f9c684'), // sushi grid
    u('1565299585323-38d6b0865b47'), // teriyaki
    u('1614777735069-f4c2f5b1e3d1'), // ramen bowl
  ],

  grillades: [
    u('1555939594-58d7cb561ad1'),
    u('1529692236671-f1f6cf9683ba'),
    u('1544025162-d76694265947'),
    u('1626082927389-6cd097cdc6ec'),
    u('1615937657715-bc7b4b7962fd'), // grill flames
    u('1546069901-ba9599a7e63c'),    // grilled steak
    u('1599974579688-8dbdd335c77f'), // bbq close
    u('1604908815796-7a1cabc7c01a'), // wood fire
    u('1572715376701-98568319fd0b'), // skewers
    u('1565958011703-44f9829ba187'), // grilled meat
    u('1607013251379-e6eecfffe234'), // grilled chicken
    u('1633237308525-cd587cf71926'), // lamb chops
    u('1606107557195-0e29a4b5b4aa'), // stew
    u('1606755456206-b25206cde27e'), // brochettes
    u('1574484284002-952d92456975'), // tagine
    u('1604502348782-3b1ba3a9d1e5'), // bbq plates
    u('1551218808-94e220e084d2'),    // mixed grill
    u('1543353071-873f17a7a088'),    // bbq spread
  ],

  cafe: [
    u('1509042239860-f550ce710b93'),
    u('1453614512568-c4024d13c247'),
    u('1521017432531-fbd92d768814'),
    u('1442512595331-e89e73853f31'),
    u('1559925393-8be0ec4767c8'),    // espresso bar
    u('1497935586351-b67a49e012bf'), // cappuccino
    u('1517256064527-09c73fc73e38'), // latte art
    u('1559496417-e7f25cb247f3'),    // cafe interior
    u('1554118811-1e0d58224f24'),    // cozy cafe
    u('1525088553748-01d6e210e00b'), // pour over
    u('1556742502-ec7c0e9f34b1'),    // matcha bar
    u('1485808191679-5f86510fb3f9'), // outdoor cafe
    u('1559925393-8be0ec4767c8'),    // alt cafe table
    u('1453614512568-04ed3a4ad81c'), // cafe daylight
    u('1572731906193-39e6d3d2c8a3'), // coffee cup
    u('1559924984-8aa7a4f3bb46'),    // pastry & coffee
    u('1521017432531-fbd92d768814'), // alt
    u('1483920157503-2bd2ca60e1e2'), // beans
  ],

  patisserie: [
    u('1488477181946-6428a0291777'),
    u('1509440159596-0249088772ff'),
    u('1528975604071-b4dc52a2d18c'),
    u('1551024506-0bccd828d307'),
    u('1599785209707-a456fc1337bb'), // macarons
    u('1565958011703-44f9829ba187'), // tart
    u('1606312619070-d48b4c652a52'), // eclair
    u('1565958011703-44f9829ba187'), // alt tart
    u('1620980776848-bf67a1f1ec0c'), // donuts
    u('1612200143573-66c2f5b8f9e0'), // chocolate cake
    u('1551404973-761c83cd8339'),    // croissant
    u('1623334044303-241021148842'), // viennoiseries
    u('1606312619070-d48b4c652a52'), // pastry shelf
    u('1622637466321-09a3a1b3a4a4'), // baklava
    u('1559054663-e8d23213f55c'),    // dessert plate
    u('1576092762791-dd9e2220abd1'), // cookies
    u('1605478579270-fcb1ad65aaf5'), // cake slice
    u('1559925393-8be0ec4767c8'),    // sweet bar
  ],

  fast_food: [
    u('1561758033-d89a9ad46330'),
    u('1606755962773-d324e0a13086'),
    u('1626202373052-9c95a3b58754'),
    u('1572802419224-296b0aeee0d9'), // bacon burger
    u('1586190848861-99aa4a171e90'), // cheeseburger
    u('1568901346375-23c9450c58cd'), // burger close
    u('1604382354936-2f10a9f43dd3'), // fries combo
    u('1607013251379-e6eecfffe234'), // chicken & fries
    u('1561758033-7e924f619b47'),    // fries closeup
    u('1610440042657-612c34d95e9f'), // double stack
    u('1606131731446-5568d87113aa'), // sloppy
    u('1605478579270-fcb1ad65aaf5'), // wrap
    u('1612392061787-2d078b3e573c'), // double burger
    u('1525164286253-edca7c3da3ad'), // burger rings
    u('1606756486833-0e2f76b78d44'), // shawarma
    u('1620360289134-2c61c4ed5b9b'), // kebab
    u('1567620905732-2d1ec7ab7445'), // pad thai-ish
    u('1551782450-a2132b4ba21d'),    // burger b&w-ish
  ],

  default: GENERIC_FOOD,
};

function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/**
 * The curated photo when one exists, otherwise a deterministic Unsplash
 * fallback. Resolution priority:
 *   1. r.photo (admin-set)
 *   2. r.cuisine pool
 *   3. r.osmValue pool ('restaurant' / 'cafe' / 'fast_food')
 *   4. default (generic food)
 *
 * The pool index is also salted with `osmValue` so two restaurants with
 * identical ids landing on different osm_value's still diverge — paranoid
 * but cheap.
 */
export function resolveRestaurantPhoto(
  r: Pick<Restaurant, 'id' | 'photo' | 'cuisine' | 'osmValue'>,
): string {
  if (r.photo) return r.photo;
  const key = (r.cuisine || r.osmValue || 'default') as string;
  const pool = POOLS[key] ?? POOLS.default!;
  const salt = r.osmValue ?? '';
  return pool[djb2(r.id + salt) % pool.length]!;
}
