/**
 * /restaurants — admin curation screen for the rider mobile catalog.
 *
 *   - Paged list of every restaurant (active + soft-deleted).
 *   - "+ Ajouter" → create-restaurant modal (single entry).
 *   - "Importer JSON" → paste/upload an array and bulk-upsert.
 *   - Per-row "Modifier" patch + "Masquer/Restaurer" toggle.
 *
 * Backed by /admin/restaurants on the API. The mobile app reads the same
 * data from /rider/restaurants.
 */

'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AppShell } from '@/components/AppShell';
import { ResponsiveTable, type Column } from '@/components/ResponsiveTable';
import { api } from '@/lib/api';

type PriceLevel = '$' | '$$' | '$$$';

interface Restaurant {
  id: string;
  name: string;
  nameFr: string | null;
  nameAr: string | null;
  nameEn: string | null;
  zone: string | null;
  cuisine: string | null;
  tags: string[];
  priceLevel: PriceLevel | null;
  rating: number | null;
  etaMin: number | null;
  etaMax: number | null;
  description: string | null;
  photo: string | null;
  photos: string[];
  phone: string | null;
  phones: string[];
  address: string | null;
  lat: number;
  lng: number;
  popularity: number;
  osmValue: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

interface ListResponse {
  items: Restaurant[];
  total: number;
  limit: number;
  offset: number;
}

interface BulkResponse {
  imported: number;
  skipped: number;
  errors: Array<{ index: number; reason: string }>;
  items: Array<{ id: string; name: string }>;
}

/** A catalog dish (one chip). */
interface Dish {
  id: string;
  nameAr: string;
  nameFr: string | null;
  category: string | null;
  usageCount: number;
}

/** A menu line as returned by GET /admin/restaurants/:id/menu. */
interface MenuItemResponse {
  id: string;
  dishId: string;
  nameAr: string;
  nameFr: string | null;
  category: string | null;
  priceMru: number;
  sortOrder: number;
  isAvailable: boolean;
}

/** A menu line while editing (price kept as a string for the input). */
interface MenuDraftItem {
  dishId: string;
  nameAr: string;
  nameFr: string | null;
  category: string | null;
  priceMru: string;
}

const DISH_CATEGORIES: { value: string; label: string }[] = [
  { value: '', label: '— catégorie —' },
  { value: 'plats', label: 'Plats' },
  { value: 'fast_food', label: 'Fast-food' },
  { value: 'boissons', label: 'Boissons' },
  { value: 'desserts', label: 'Desserts' },
];

/** Client mirror of the API dish-name normalization (dedup + search). */
function normalizeDishName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

const CUISINES = [
  '', 'mauritanien', 'pizza', 'burger', 'libanais',
  'asiatique', 'cafe', 'patisserie', 'grillades',
] as const;

export default function RestaurantsPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [cuisineFilter, setCuisineFilter] = useState('');
  const [showInactive, setShowInactive] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [showBulk, setShowBulk] = useState(false);
  const [editing, setEditing] = useState<Restaurant | null>(null);

  const list = useQuery<ListResponse>({
    queryKey: ['admin-restaurants', search, cuisineFilter, showInactive],
    queryFn: async () => {
      const params = new URLSearchParams({ limit: '500' });
      if (search.trim()) params.set('search', search.trim());
      if (cuisineFilter) params.set('cuisine', cuisineFilter);
      if (!showInactive) params.set('includeInactive', 'false');
      const r = await api.get(`/admin/restaurants?${params.toString()}`);
      return r.data as ListResponse;
    },
  });

  const softDelete = useMutation({
    mutationFn: async (id: string) => {
      await api.delete(`/admin/restaurants/${id}`);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-restaurants'] }),
  });

  const restore = useMutation({
    mutationFn: async (id: string) => {
      await api.patch(`/admin/restaurants/${id}`, { isActive: true });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['admin-restaurants'] }),
  });

  const counts = useMemo(() => {
    const items = list.data?.items ?? [];
    return {
      active: items.filter((r) => r.isActive).length,
      hidden: items.filter((r) => !r.isActive).length,
      withPhoto: items.filter((r) => !!r.photo).length,
    };
  }, [list.data]);

  const columns: Column<Restaurant>[] = [
    {
      key: 'restaurant',
      header: 'Restaurant',
      mobilePrimary: true,
      cell: (r) => (
        <div className="flex items-center gap-3">
          {r.photo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={r.photo} alt="" className="w-10 h-10 rounded-md object-cover bg-slate-100" />
          ) : (
            <div className="w-10 h-10 rounded-md bg-orange-100 text-orange-700 font-semibold flex items-center justify-center">
              {r.name.charAt(0).toUpperCase() || '?'}
            </div>
          )}
          <div className="min-w-0">
            <div className="font-medium text-slate-900 truncate">{r.name}</div>
            <div className="text-xs text-slate-500 font-mono truncate">{r.id}</div>
          </div>
        </div>
      ),
    },
    {
      key: 'cuisine',
      header: 'Cuisine',
      cell: (r) =>
        r.cuisine ? (
          <span className="text-xs bg-slate-100 text-slate-700 px-2 py-1 rounded">{r.cuisine}</span>
        ) : (
          <span className="text-xs text-slate-400">—</span>
        ),
    },
    {
      key: 'zone',
      header: 'Zone',
      cell: (r) => <span className="text-slate-600">{r.zone ?? '—'}</span>,
    },
    {
      key: 'coords',
      header: 'Coords',
      cell: (r) => (
        <span className="text-slate-500 text-xs font-mono">
          {r.lat.toFixed(4)}, {r.lng.toFixed(4)}
        </span>
      ),
    },
    {
      key: 'popularity',
      header: 'Popularité',
      cell: (r) => <span className="text-slate-600">{r.popularity}</span>,
    },
    {
      key: 'status',
      header: 'État',
      cell: (r) =>
        r.isActive ? (
          <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-1 rounded">Actif</span>
        ) : (
          <span className="text-xs bg-slate-200 text-slate-600 px-2 py-1 rounded">Masqué</span>
        ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      hideOnMobile: true,
      cell: (r) => (
        <div className="flex justify-end gap-3">
          <button
            onClick={() => setEditing(r)}
            className="text-xs text-blue-700 hover:text-blue-900 font-medium"
          >
            Modifier
          </button>
          {r.isActive ? (
            <button
              onClick={() => {
                if (confirm(`Masquer "${r.name}" du catalogue mobile ?`)) softDelete.mutate(r.id);
              }}
              className="text-xs text-red-700 hover:text-red-900 font-medium"
            >
              Masquer
            </button>
          ) : (
            <button
              onClick={() => restore.mutate(r.id)}
              className="text-xs text-emerald-700 hover:text-emerald-900 font-medium"
            >
              Restaurer
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <AppShell>
      <div className="max-w-7xl mx-auto p-4 md:p-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between mb-6 gap-3">
          <div>
            <h1 className="text-2xl font-bold text-slate-900">Restaurants</h1>
            <p className="text-sm text-slate-500 mt-1">
              {list.data ? (
                <>
                  {list.data.total} adresses · {counts.active} actives · {counts.hidden} masquées · {counts.withPhoto} avec photo
                </>
              ) : (
                'Chargement...'
              )}
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              onClick={() => setShowBulk(true)}
              className="flex-1 sm:flex-none bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg font-medium text-sm"
            >
              Importer JSON
            </button>
            <button
              onClick={() => setShowCreate(true)}
              className="flex-1 sm:flex-none bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-lg font-medium text-sm"
            >
              + Ajouter
            </button>
          </div>
        </div>

        {/* Filters */}
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-3 mb-4">
          <input
            type="search"
            placeholder="Rechercher un nom, un quartier…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm"
          />
          <div className="flex gap-2 sm:gap-3">
            <select
              value={cuisineFilter}
              onChange={(e) => setCuisineFilter(e.target.value)}
              className="flex-1 sm:flex-none border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
            >
              <option value="">Toutes les cuisines</option>
              {CUISINES.filter(Boolean).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setShowInactive((v) => !v)}
              className={`px-3 py-2 text-sm rounded-lg border flex items-center gap-2 whitespace-nowrap ${
                showInactive
                  ? 'bg-slate-100 border-slate-300 text-slate-700'
                  : 'bg-white border-slate-300 text-slate-500 hover:bg-slate-50'
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${showInactive ? 'bg-slate-500' : 'bg-slate-300'}`} />
              <span className="hidden sm:inline">Inclure masquées</span>
              <span className="sm:hidden">Masquées</span>
            </button>
          </div>
        </div>

        {list.isLoading && <div className="text-slate-500">Chargement...</div>}
        {list.error ? <div className="text-red-600">Erreur de chargement.</div> : null}

        {list.data && (
          <ResponsiveTable
            data={list.data.items}
            columns={columns}
            rowKey={(r) => r.id}
            emptyMessage={"Aucun restaurant. Importe ton JSON ou clique \"+ Ajouter\"."}
            mobileActions={(r) => (
              <>
                <button
                  onClick={() => setEditing(r)}
                  className="text-xs text-blue-700 hover:text-blue-900 font-medium px-3 py-1.5 bg-blue-50 rounded-md"
                >
                  Modifier
                </button>
                {r.isActive ? (
                  <button
                    onClick={() => {
                      if (confirm(`Masquer "${r.name}" du catalogue mobile ?`)) softDelete.mutate(r.id);
                    }}
                    className="text-xs text-red-700 hover:text-red-900 font-medium px-3 py-1.5 bg-red-50 rounded-md"
                  >
                    Masquer
                  </button>
                ) : (
                  <button
                    onClick={() => restore.mutate(r.id)}
                    className="text-xs text-emerald-700 hover:text-emerald-900 font-medium px-3 py-1.5 bg-emerald-50 rounded-md"
                  >
                    Restaurer
                  </button>
                )}
              </>
            )}
          />
        )}

        {showCreate || editing ? (
          <RestaurantForm
            initial={editing ?? undefined}
            onClose={() => { setShowCreate(false); setEditing(null); }}
            onSaved={() => {
              setShowCreate(false);
              setEditing(null);
              qc.invalidateQueries({ queryKey: ['admin-restaurants'] });
            }}
          />
        ) : null}

        {showBulk ? (
          <BulkImportModal
            onClose={() => setShowBulk(false)}
            onDone={() => {
              setShowBulk(false);
              qc.invalidateQueries({ queryKey: ['admin-restaurants'] });
            }}
          />
        ) : null}
      </div>
    </AppShell>
  );
}

/* ------------------------------------------------------------------ */

/** Extract lat, lng and optional name from a Google Maps URL. */
function parseGoogleMapsUrl(url: string): { lat: string; lng: string; name?: string } | null {
  try {
    // Format: https://maps.google.com/?q=18.0862,-15.9753
    // Format: https://www.google.com/maps/place/Restaurant+Name/@18.0862,-15.9753,17z
    // Format: https://www.google.com/maps/@18.0862,-15.9753,17z
    // Format: https://maps.app.goo.gl/... (short link — can't parse without fetch)
    const coordsRegex = /@(-?\d+\.\d+),(-?\d+\.\d+)/;
    const qRegex = /[?&]q=(-?\d+\.\d+),(-?\d+\.\d+)/;
    const placeRegex = /\/place\/([^/@]+)\//;

    let lat: string | undefined;
    let lng: string | undefined;
    let name: string | undefined;

    const cm = url.match(coordsRegex);
    if (cm) { lat = cm[1]; lng = cm[2]; }

    if (!lat) {
      const qm = url.match(qRegex);
      if (qm) { lat = qm[1]; lng = qm[2]; }
    }

    if (!lat) return null;

    const pm = url.match(placeRegex);
    if (pm) {
      name = decodeURIComponent(pm[1]!.replace(/\+/g, ' '));
    }

    return { lat: lat!, lng: lng!, name };
  } catch {
    return null;
  }
}

/**
 * Normalize a Mauritanian phone number to the canonical +222XXXXXXXX form.
 * Accepts input with or without the +222 prefix: a bare 8-digit local number
 * is prefixed, a 222/00222 prefix is turned into +222, and anything already
 * starting with "+" just has its separators stripped. Unrecognized shapes are
 * left as typed (trimmed) so nothing is silently dropped.
 */
function normalizePhone(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return '';
  const digits = trimmed.replace(/\D/g, '');
  if (trimmed.startsWith('+')) return `+${digits}`;
  if (digits.startsWith('00222')) return `+${digits.slice(2)}`;
  if (digits.startsWith('222') && digits.length === 11) return `+${digits}`;
  if (digits.length === 8) return `+222${digits}`;
  return trimmed;
}

function RestaurantForm({
  initial, onClose, onSaved,
}: {
  initial?: Restaurant;
  onClose: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!initial;
  const [nameFr, setNameFr] = useState(initial?.nameFr ?? '');
  const [nameAr, setNameAr] = useState(initial?.nameAr ?? '');
  // A restaurant can have several numbers; always keep at least one input row.
  const [phones, setPhones] = useState<string[]>(
    initial?.phones?.length ? initial.phones : (initial?.phone ? [initial.phone] : ['']),
  );
  const [lat, setLat] = useState(initial?.lat?.toString() ?? '');
  const [lng, setLng] = useState(initial?.lng?.toString() ?? '');
  const [menu, setMenu] = useState<MenuDraftItem[]>([]);
  const [err, setErr] = useState<string | null>(null);

  // Load the existing menu when editing an existing restaurant.
  const menuQuery = useQuery<{ items: MenuItemResponse[] }>({
    queryKey: ['admin-restaurant-menu', initial?.id],
    queryFn: async () => (await api.get(`/admin/restaurants/${initial!.id}/menu`)).data,
    enabled: isEdit,
  });
  useEffect(() => {
    if (menuQuery.data) {
      setMenu(
        menuQuery.data.items.map((m) => ({
          dishId: m.dishId,
          nameAr: m.nameAr,
          nameFr: m.nameFr,
          category: m.category,
          priceMru: String(m.priceMru),
        })),
      );
    }
  }, [menuQuery.data]);

  // GPS position
  const [gpsLoading, setGpsLoading] = useState(false);
  const handleGps = useCallback(() => {
    if (!navigator.geolocation) {
      setErr('La géolocalisation n\'est pas supportée par ce navigateur.');
      return;
    }
    setGpsLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLat(pos.coords.latitude.toFixed(6));
        setLng(pos.coords.longitude.toFixed(6));
        setGpsLoading(false);
      },
      (e) => {
        setErr(`Erreur GPS : ${e.message}`);
        setGpsLoading(false);
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  }, []);

  // Google Maps import
  const [mapsUrl, setMapsUrl] = useState('');
  const handleMapsImport = useCallback(() => {
    const parsed = parseGoogleMapsUrl(mapsUrl);
    if (!parsed) {
      setErr('Lien Google Maps invalide. Copie un lien contenant des coordonnées (@lat,lng).');
      return;
    }
    setLat(parsed.lat);
    setLng(parsed.lng);
    if (parsed.name && !nameFr.trim()) setNameFr(parsed.name);
    setMapsUrl('');
    setErr(null);
  }, [mapsUrl, nameFr]);

  // Canonical name derived from the French name, falling back to Arabic —
  // the form no longer exposes a separate "Nom" field.
  const primaryName = nameFr.trim() || nameAr.trim();

  const submit = useMutation({
    mutationFn: async () => {
      setErr(null);
      // Every selected dish must carry a valid price.
      if (menu.some((m) => !(Number(m.priceMru) > 0))) {
        throw new Error('Chaque plat du menu doit avoir un prix (> 0).');
      }

      const cleanedPhones = phones.map(normalizePhone).filter(Boolean);
      const payload = {
        name: primaryName,
        nameFr: nameFr.trim() || null,
        nameAr: nameAr.trim() || null,
        phones: cleanedPhones,
        // Keep the legacy single-value field in sync with the first entry.
        phone: cleanedPhones[0] ?? null,
        lat: Number(lat),
        lng: Number(lng),
      };
      const saved = isEdit
        ? (await api.patch(`/admin/restaurants/${initial!.id}`, payload)).data
        : (await api.post(`/admin/restaurants`, payload)).data;

      // Persist the menu (dish + price) for the saved restaurant.
      await api.put(`/admin/restaurants/${saved.id}/menu`, {
        items: menu.map((m, i) => ({
          dishId: m.dishId,
          priceMru: Math.round(Number(m.priceMru)),
          sortOrder: i,
        })),
      });
      return saved;
    },
    onSuccess: () => onSaved(),
    onError: (e: any) => {
      setErr(e?.response?.data?.error?.message ?? (e as Error).message ?? 'Erreur lors de l\'enregistrement.');
    },
  });

  return (
    <Modal title={isEdit ? `Modifier — ${initial!.name}` : 'Nouveau restaurant'} onClose={onClose}>
      {/* Google Maps import bar */}
      <div className="mb-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
        <label className="text-xs font-medium text-blue-800 block mb-1.5">
          📍 Importer depuis Google Maps
        </label>
        <div className="flex gap-2">
          <input
            type="text"
            value={mapsUrl}
            onChange={(e) => setMapsUrl(e.target.value)}
            placeholder="Coller un lien Google Maps ici…"
            className="flex-1 border border-blue-300 rounded-lg px-3 py-1.5 text-sm bg-white"
          />
          <button
            type="button"
            onClick={handleMapsImport}
            disabled={!mapsUrl.trim()}
            className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-40 text-white rounded-lg font-medium whitespace-nowrap"
          >
            Importer
          </button>
        </div>
        <p className="text-[11px] text-blue-600 mt-1">
          Remplit automatiquement les coordonnées et le nom du restaurant.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Nom (français)" value={nameFr} onChange={setNameFr} placeholder="Pizza Lina" />
        <Field label="Nom (arabe)" value={nameAr} onChange={setNameAr} placeholder="بيتزا لينا" />

        {/* Phone numbers — a restaurant can have several. */}
        <div className="col-span-2">
          <label className="text-xs text-slate-600 block mb-1">Numéros de téléphone</label>
          <div className="flex flex-col gap-2">
            {phones.map((p, i) => (
              <div key={i} className="flex gap-2">
                <input
                  type="tel"
                  value={p}
                  onChange={(e) =>
                    setPhones((prev) => prev.map((v, idx) => (idx === i ? e.target.value : v)))
                  }
                  placeholder="+222 …"
                  className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
                {phones.length > 1 ? (
                  <button
                    type="button"
                    onClick={() => setPhones((prev) => prev.filter((_, idx) => idx !== i))}
                    className="px-3 py-2 text-sm text-red-600 hover:bg-red-50 border border-slate-300 rounded-lg"
                    aria-label="Supprimer ce numéro"
                  >
                    ×
                  </button>
                ) : null}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setPhones((prev) => [...prev, ''])}
            className="mt-2 text-xs font-medium text-emerald-700 hover:text-emerald-900"
          >
            + Ajouter un numéro
          </button>
        </div>

        {/* Lat/Lng with GPS button */}
        <div className="col-span-2">
          <div className="flex items-end gap-2">
            <Field label="Latitude *" value={lat} onChange={setLat} type="number" className="flex-1" />
            <Field label="Longitude *" value={lng} onChange={setLng} type="number" className="flex-1" />
            <button
              type="button"
              onClick={handleGps}
              disabled={gpsLoading}
              className="mb-[1px] px-3 py-2 text-sm bg-slate-100 hover:bg-slate-200 border border-slate-300 rounded-lg font-medium whitespace-nowrap disabled:opacity-50"
            >
              {gpsLoading ? '⏳' : '📍'} Ma position
            </button>
          </div>
        </div>

        {/* Menu — searchable dish chips + a price per selected dish. */}
        <div className="col-span-2">
          <label className="text-xs text-slate-600 block mb-1">Menu (plats + prix)</label>
          <MenuBuilder value={menu} onChange={setMenu} loading={isEdit && menuQuery.isLoading} />
        </div>
      </div>

      {err ? <div className="mt-3 text-sm text-red-600">{err}</div> : null}

      <div className="flex justify-end gap-2 mt-5">
        <button onClick={onClose} className="px-4 py-2 text-sm border border-slate-300 rounded-lg">
          Annuler
        </button>
        <button
          onClick={() => submit.mutate()}
          disabled={!primaryName || !lat || !lng || submit.isPending}
          className="px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white rounded-lg font-medium"
        >
          {submit.isPending ? 'Enregistrement…' : isEdit ? 'Enregistrer' : 'Créer'}
        </button>
      </div>
    </Modal>
  );
}

/**
 * Menu builder: a searchable list of dish "chips" (the shared catalog) plus a
 * price field per selected dish. Clicking a chip adds the dish to the menu;
 * typing a new name lets the collector create a brand-new dish (chip) that then
 * becomes reusable for every restaurant.
 */
function MenuBuilder({
  value, onChange, loading,
}: {
  value: MenuDraftItem[];
  onChange: (m: MenuDraftItem[]) => void;
  loading?: boolean;
}) {
  const qc = useQueryClient();
  const [query, setQuery] = useState('');
  const [newCategory, setNewCategory] = useState('');
  const [createErr, setCreateErr] = useState<string | null>(null);

  const dishesQuery = useQuery<{ items: Dish[] }>({
    queryKey: ['admin-dishes'],
    queryFn: async () => (await api.get('/admin/dishes?limit=500')).data,
  });
  const dishes = dishesQuery.data?.items ?? [];

  const inMenu = useMemo(() => new Set(value.map((m) => m.dishId)), [value]);
  const nq = normalizeDishName(query);
  const filtered = useMemo(
    () =>
      dishes.filter(
        (d) =>
          !inMenu.has(d.id) &&
          (!nq ||
            normalizeDishName(d.nameAr).includes(nq) ||
            (d.nameFr ? normalizeDishName(d.nameFr).includes(nq) : false)),
      ),
    [dishes, inMenu, nq],
  );
  const exactExists = dishes.some((d) => normalizeDishName(d.nameAr) === nq);
  const canCreate = nq.length > 0 && !exactExists;

  const addDish = (d: Dish) => {
    onChange([
      ...value,
      { dishId: d.id, nameAr: d.nameAr, nameFr: d.nameFr, category: d.category, priceMru: '' },
    ]);
    setQuery('');
  };

  const createDish = useMutation({
    mutationFn: async () => {
      setCreateErr(null);
      const r = await api.post('/admin/dishes', {
        nameAr: query.trim(),
        category: newCategory || null,
      });
      return r.data as Dish;
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['admin-dishes'] });
      addDish(d);
      setNewCategory('');
    },
    onError: (e: any) => setCreateErr(e?.response?.data?.error?.message ?? 'Erreur création plat.'),
  });

  const setPrice = (i: number, v: string) =>
    onChange(value.map((m, idx) => (idx === i ? { ...m, priceMru: v } : m)));
  const removeItem = (i: number) => onChange(value.filter((_, idx) => idx !== i));

  return (
    <div className="border border-slate-200 rounded-lg p-3 bg-slate-50/50">
      {/* Search / create bar */}
      <div className="flex gap-2">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Rechercher un plat ou en créer un…"
          className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm bg-white"
        />
        {canCreate ? (
          <select
            value={newCategory}
            onChange={(e) => setNewCategory(e.target.value)}
            className="border border-slate-300 rounded-lg px-2 py-2 text-xs bg-white"
          >
            {DISH_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>{c.label}</option>
            ))}
          </select>
        ) : null}
      </div>

      {createErr ? <div className="mt-2 text-xs text-red-600">{createErr}</div> : null}

      {/* Chips */}
      <div className="flex flex-wrap gap-2 mt-3">
        {canCreate ? (
          <button
            type="button"
            onClick={() => createDish.mutate()}
            disabled={createDish.isPending}
            className="px-3 py-1.5 text-sm rounded-full border border-dashed border-emerald-400 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 disabled:opacity-50"
          >
            + Créer « {query.trim()} »
          </button>
        ) : null}
        {dishesQuery.isLoading ? (
          <span className="text-xs text-slate-400">Chargement des plats…</span>
        ) : filtered.length === 0 && !canCreate ? (
          <span className="text-xs text-slate-400">Aucun plat. Tape un nom pour en créer un.</span>
        ) : (
          filtered.slice(0, 60).map((d) => (
            <button
              key={d.id}
              type="button"
              onClick={() => addDish(d)}
              className="px-3 py-1.5 text-sm rounded-full border border-slate-300 bg-white text-slate-700 hover:border-emerald-400 hover:bg-emerald-50"
              title={d.category ?? undefined}
            >
              {d.nameAr}
              {d.usageCount > 0 ? <span className="text-slate-400"> · {d.usageCount}</span> : null}
            </button>
          ))
        )}
      </div>

      {/* Selected dishes with price */}
      <div className="mt-4">
        {loading ? (
          <div className="text-xs text-slate-400">Chargement du menu…</div>
        ) : value.length === 0 ? (
          <div className="text-xs text-slate-400">
            Aucun plat sélectionné. Clique une chip ci-dessus pour l’ajouter, puis saisis son prix.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {value.map((m, i) => (
              <div key={m.dishId} className="flex items-center gap-2 bg-white border border-slate-200 rounded-lg px-3 py-2">
                <span className="flex-1 text-sm text-slate-800 truncate">
                  {m.nameAr}
                  {m.category ? <span className="text-slate-400 text-xs"> · {m.category}</span> : null}
                </span>
                <input
                  type="number"
                  value={m.priceMru}
                  onChange={(e) => setPrice(i, e.target.value)}
                  placeholder="Prix"
                  className="w-24 border border-slate-300 rounded-lg px-2 py-1 text-sm text-right"
                  min={0}
                />
                <span className="text-xs text-slate-500">MRU</span>
                <button
                  type="button"
                  onClick={() => removeItem(i)}
                  className="text-red-500 hover:text-red-700 text-lg leading-none px-1"
                  aria-label="Retirer ce plat"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function BulkImportModal({ onClose, onDone }: { onClose: () => void; onDone: () => void }) {
  const [text, setText] = useState('');
  const [result, setResult] = useState<BulkResponse | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const submit = useMutation({
    mutationFn: async () => {
      setErr(null);
      let items: unknown;
      try {
        items = JSON.parse(text);
      } catch (e) {
        throw new Error('JSON invalide : ' + (e as Error).message);
      }
      if (!Array.isArray(items)) throw new Error('Le JSON doit être un tableau.');
      const r = await api.post<BulkResponse>('/admin/restaurants/bulk-import', { items });
      return r.data;
    },
    onSuccess: (data) => setResult(data),
    onError: (e: any) => setErr(e?.response?.data?.error?.message ?? (e as Error).message),
  });

  const onFile = async (file: File) => {
    const t = await file.text();
    setText(t);
  };

  return (
    <Modal title="Importer un JSON de restaurants" onClose={onClose}>
      <p className="text-sm text-slate-600 mb-3">
        Colle un tableau JSON (format OSM <code className="text-xs">{`{name_default, lat, lng, osm_value, …}`}</code> ou
        format admin <code className="text-xs">{`{name, lat, lng, cuisine, …}`}</code>). Les deux peuvent être mélangés.
      </p>

      <label className="text-xs text-slate-600 block mb-1">Fichier .json</label>
      <input
        type="file"
        accept="application/json,.json"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void onFile(f); }}
        className="mb-3 text-sm"
      />

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={10}
        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-xs font-mono"
        placeholder='[{"name_default": "Pizza Lina", "lat": 18.09, "lng": -15.97, "osm_value": "restaurant"}, …]'
      />

      {err ? <div className="mt-3 text-sm text-red-600">{err}</div> : null}

      {result ? (
        <div className="mt-3 text-sm bg-emerald-50 border border-emerald-200 text-emerald-900 rounded-lg p-3">
          ✓ {result.imported} entrées importées, {result.skipped} ignorées.
          {result.errors.length > 0 ? (
            <details className="mt-2">
              <summary className="cursor-pointer text-xs">Voir les erreurs ({result.errors.length})</summary>
              <ul className="mt-1 text-xs text-slate-600 max-h-40 overflow-auto">
                {result.errors.slice(0, 50).map((e) => (
                  <li key={e.index}>#{e.index}: {e.reason}</li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}

      <div className="flex justify-end gap-2 mt-5">
        <button onClick={result ? onDone : onClose} className="px-4 py-2 text-sm border border-slate-300 rounded-lg">
          {result ? 'Terminer' : 'Annuler'}
        </button>
        {!result ? (
          <button
            onClick={() => submit.mutate()}
            disabled={!text.trim() || submit.isPending}
            className="px-4 py-2 text-sm bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 text-white rounded-lg font-medium"
          >
            {submit.isPending ? 'Import…' : 'Importer'}
          </button>
        ) : null}
      </div>
    </Modal>
  );
}

/* ------------------------------------------------------------------ */

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-start justify-center pt-6 sm:pt-20 px-3 sm:px-4 z-50 overflow-auto"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-xl max-w-2xl w-full p-4 sm:p-6 mb-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-900">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl leading-none">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function Field({
  label, value, onChange, type = 'text', placeholder, className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={className}>
      <label className="text-xs text-slate-600 block mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
        step={type === 'number' ? 'any' : undefined}
      />
    </div>
  );
}
