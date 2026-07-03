import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, startTestApp, type TestAppHandle } from './helpers/app.js';

const { walletMock, topupMock } = vi.hoisted(() => ({
  walletMock: { getWalletSummary: vi.fn() },
  topupMock: { createTopup: vi.fn(), listMyTopups: vi.fn() },
}));

vi.mock('../src/modules/wallet/wallet.service.js', () => walletMock);
vi.mock('../src/modules/wallet/topup.service.js', () => topupMock);

import { captainWalletRouter } from '../src/modules/captain/wallet.routes.js';

const CAPTAIN = { id: 'captain-1', role: 'captain' as const };
let handle: TestAppHandle | null = null;

async function start() {
  handle = await startTestApp('/captain/wallet', captainWalletRouter, CAPTAIN);
  return handle;
}

beforeEach(() => {
  walletMock.getWalletSummary.mockReset();
  topupMock.createTopup.mockReset();
  topupMock.listMyTopups.mockReset();
});

afterEach(async () => {
  if (handle) await handle.close();
  handle = null;
});

describe('GET /captain/wallet', () => {
  it('returns the balance and recent transactions', async () => {
    walletMock.getWalletSummary.mockResolvedValue({ balanceMru: 320, transactions: [{ id: 't1' }] });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/captain/wallet');
    expect(res.status).toBe(200);
    expect(res.body.balanceMru).toBe(320);
    expect(walletMock.getWalletSummary).toHaveBeenCalledWith('captain-1', 20);
  });
});

describe('GET /captain/wallet/transactions', () => {
  it('honors the limit query param', async () => {
    walletMock.getWalletSummary.mockResolvedValue({ balanceMru: 0, transactions: [{ id: 't1' }] });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/captain/wallet/transactions?limit=100');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 't1' }]);
    expect(walletMock.getWalletSummary).toHaveBeenCalledWith('captain-1', 100);
  });

  it('rejects a limit above 200', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/captain/wallet/transactions?limit=500');
    expect(res.status).toBe(400);
  });
});

describe('POST /captain/wallet/topups', () => {
  async function postTopup(baseUrl: string, fields: Record<string, string>, withFile = true) {
    const form = new FormData();
    for (const [k, v] of Object.entries(fields)) form.set(k, v);
    if (withFile) {
      form.set('file', new Blob([Buffer.from('screenshot')], { type: 'image/png' }), 'proof.png');
    }
    const res = await fetch(`${baseUrl}/captain/wallet/topups`, { method: 'POST', body: form });
    return { status: res.status, body: await res.json().catch(() => null) };
  }

  it('creates a topup request with a screenshot', async () => {
    topupMock.createTopup.mockResolvedValue({ id: 'topup-1', status: 'pending' });
    const { baseUrl } = await start();
    const res = await postTopup(baseUrl, {
      provider: 'bankily',
      claimedAmountMru: '500',
      providerRefNumber: 'BK-123',
    });
    expect(res.status).toBe(200);
    expect(topupMock.createTopup).toHaveBeenCalledWith(
      expect.objectContaining({
        captainId: 'captain-1',
        provider: 'bankily',
        claimedAmountMru: 500,
        providerRefNumber: 'BK-123',
      }),
    );
  });

  it('returns 400 no_file when the screenshot is missing', async () => {
    const { baseUrl } = await start();
    const res = await postTopup(baseUrl, { provider: 'bankily', claimedAmountMru: '500' }, false);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('no_file');
  });

  it('rejects an unknown provider with 400', async () => {
    const { baseUrl } = await start();
    const res = await postTopup(baseUrl, { provider: 'paypal', claimedAmountMru: '500' });
    expect(res.status).toBe(400);
  });
});

describe('GET /captain/wallet/topups', () => {
  it('lists my topups', async () => {
    topupMock.listMyTopups.mockResolvedValue([{ id: 'topup-1' }]);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/captain/wallet/topups');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: 'topup-1' }]);
    expect(topupMock.listMyTopups).toHaveBeenCalledWith('captain-1');
  });
});
