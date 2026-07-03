/**
 * Integration test for the restaurants data layer: fetchRestaurants over a
 * mocked `api` (axios). Pins the request contract with GET /rider/restaurants
 * — which query params are sent, how they're trimmed/omitted, and that the
 * paginated envelope is unwrapped to `.items`. Mocking `../lib/api` keeps this
 * in the node test env without pulling in axios / auth / async-storage.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/api', () => ({ api: { get: vi.fn() } }));

import { api } from '../lib/api';
import { fetchRestaurants } from '../lib/restaurants';

const getMock = vi.mocked(api.get);

function envelope(items: unknown[]) {
  return { data: { items, total: items.length, limit: 20, offset: 0 } };
}

beforeEach(() => {
  getMock.mockReset();
  getMock.mockResolvedValue(envelope([]));
});

describe('fetchRestaurants', () => {
  it('hits the bare endpoint with no params by default', async () => {
    await fetchRestaurants();
    expect(getMock).toHaveBeenCalledWith('/rider/restaurants');
  });

  it('unwraps the paginated envelope to the items array', async () => {
    getMock.mockResolvedValue(envelope([{ id: 'r1' }, { id: 'r2' }]));
    const items = await fetchRestaurants();
    expect(items).toEqual([{ id: 'r1' }, { id: 'r2' }]);
  });

  it('trims and forwards a search term', async () => {
    await fetchRestaurants({ search: '  pizza  ' });
    expect(getMock).toHaveBeenCalledWith('/rider/restaurants?search=pizza');
  });

  it('omits a whitespace-only search', async () => {
    await fetchRestaurants({ search: '   ' });
    expect(getMock).toHaveBeenCalledWith('/rider/restaurants');
  });

  it('omits the "all" cuisine sentinel but forwards a real cuisine', async () => {
    await fetchRestaurants({ cuisine: 'all' });
    expect(getMock).toHaveBeenCalledWith('/rider/restaurants');

    await fetchRestaurants({ cuisine: 'pizza' });
    expect(getMock).toHaveBeenLastCalledWith('/rider/restaurants?cuisine=pizza');
  });

  it('combines search and cuisine in the query string', async () => {
    await fetchRestaurants({ search: 'chez', cuisine: 'burger' });
    expect(getMock).toHaveBeenCalledWith('/rider/restaurants?search=chez&cuisine=burger');
  });
});
