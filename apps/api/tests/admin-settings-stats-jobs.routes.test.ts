import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, startTestApp, type TestAppHandle } from './helpers/app.js';
import { dispatchSql, rows } from './helpers/db.js';

const {
  queryMock,
  auditMock,
  settingsSvcMock,
  notifyBonusMock,
  docReqSvcMock,
  jobsMocks,
} = vi.hoisted(() => ({
  queryMock: vi.fn(),
  auditMock: vi.fn(),
  settingsSvcMock: {
    getPricingSettings: vi.fn(),
    updatePricingSettings: vi.fn(),
  },
  notifyBonusMock: vi.fn(),
  docReqSvcMock: {
    getDocumentRequirements: vi.fn(),
    updateDocumentRequirement: vi.fn(),
    getDocumentTypesForStage: vi.fn(),
  },
  jobsMocks: {
    processOccurrences: vi.fn(),
    compute: vi.fn(),
    expireOld: vi.fn(),
    reapStaleSessions: vi.fn(),
    expireDocumentsAndSuspendCaptains: vi.fn(),
    listExpiringSoon: vi.fn(),
    scanPartnerEarnings: vi.fn(),
  },
}));

vi.mock('../src/db/pool.js', () => ({
  pool: { query: queryMock, connect: vi.fn(), on: vi.fn() },
  withTx: vi.fn(),
}));
vi.mock('../src/modules/admin/audit.js', () => ({ audit: auditMock }));
vi.mock('../src/modules/admin/app-settings.service.js', () => settingsSvcMock);
vi.mock('../src/modules/notifications/notifications.service.js', () => ({
  notifyCaptainsBonusConfigChanged: notifyBonusMock,
}));
// DOCUMENT_STAGES est une constante, pas un mock : la garder hors de
// `docReqSvcMock` évite que le mockReset global du beforeEach ne la traite
// comme une fonction espionne.
vi.mock('../src/modules/admin/document-requirements.service.js', () => ({
  DOCUMENT_STAGES: ['application', 'online', 'payout', 'off'],
  ...docReqSvcMock,
}));
vi.mock('../src/modules/recurring/recurring.service.js', () => ({
  processOccurrences: jobsMocks.processOccurrences,
}));
vi.mock('../src/modules/heatmap/heatmap.service.js', () => ({ compute: jobsMocks.compute }));
vi.mock('../src/modules/reports/road-reports.service.js', () => ({
  expireOld: jobsMocks.expireOld,
}));
vi.mock('../src/modules/home/going-home.service.js', () => ({
  reapStaleSessions: jobsMocks.reapStaleSessions,
}));
vi.mock('../src/modules/jobs/doc-expiry.service.js', () => ({
  expireDocumentsAndSuspendCaptains: jobsMocks.expireDocumentsAndSuspendCaptains,
  listExpiringSoon: jobsMocks.listExpiringSoon,
}));
vi.mock('../src/modules/partners/fraud.service.js', () => ({
  scanPartnerEarnings: jobsMocks.scanPartnerEarnings,
}));

import { adminSettingsRouter } from '../src/modules/admin/settings.routes.js';
import { adminStatsRouter } from '../src/modules/admin/stats.routes.js';
import { adminDocumentRequirementsRouter } from '../src/modules/admin/document-requirements.routes.js';
import { adminJobsRouter } from '../src/modules/jobs/admin-jobs.routes.js';

const ADMIN = { id: 'admin-1', role: 'admin' as const, adminRole: 'super_admin' };
let handle: TestAppHandle | null = null;

beforeEach(() => {
  queryMock.mockReset();
  queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
  auditMock.mockReset();
  auditMock.mockResolvedValue(undefined);
  for (const fn of Object.values(settingsSvcMock)) fn.mockReset();
  notifyBonusMock.mockReset();
  notifyBonusMock.mockResolvedValue(undefined);
  for (const fn of Object.values(docReqSvcMock)) fn.mockReset();
  for (const fn of Object.values(jobsMocks)) fn.mockReset();
});

afterEach(async () => {
  if (handle) await handle.close();
  handle = null;
});

describe('admin settings', () => {
  const baseSettings = {
    baseFareMru: 20,
    perKmMru: 30,
    commissionBonusEnabled: false,
    commissionBonusThresholdMru: 1000,
    commissionBonusWindowDays: 7,
    commissionBonusRewardDays: 3,
  };

  async function start() {
    handle = await startTestApp('/admin/settings', adminSettingsRouter, ADMIN);
    return handle;
  }

  it('GET / returns the pricing knobs', async () => {
    settingsSvcMock.getPricingSettings.mockResolvedValue(baseSettings);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/admin/settings');
    expect(res.status).toBe(200);
    expect(res.body.baseFareMru).toBe(20);
  });

  it('PUT / patches a knob and audits the diff', async () => {
    settingsSvcMock.getPricingSettings.mockResolvedValue(baseSettings);
    settingsSvcMock.updatePricingSettings.mockResolvedValue({ ...baseSettings, perKmMru: 35 });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'PUT', '/admin/settings', { perKmMru: 35 });
    expect(res.status).toBe(200);
    expect(res.body.perKmMru).toBe(35);
    expect(settingsSvcMock.updatePricingSettings).toHaveBeenCalledWith('admin-1', { perKmMru: 35 });
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'app_settings.update' }),
    );
    expect(notifyBonusMock).not.toHaveBeenCalled();
  });

  it('PUT / broadcasts to captains when a bonus knob changes', async () => {
    settingsSvcMock.getPricingSettings.mockResolvedValue(baseSettings);
    settingsSvcMock.updatePricingSettings.mockResolvedValue({
      ...baseSettings,
      commissionBonusEnabled: true,
    });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'PUT', '/admin/settings', { commissionBonusEnabled: true });
    expect(res.status).toBe(200);
    expect(notifyBonusMock).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true, thresholdMru: 1000 }),
    );
  });

  it('PUT / with an empty body is a 400', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'PUT', '/admin/settings', {});
    expect(res.status).toBe(400);
  });

  it('PUT / rejects identical night window bounds', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'PUT', '/admin/settings', {
      nightPriceStartHour: 22,
      nightPriceEndHour: 22,
    });
    expect(res.status).toBe(400);
  });
});

describe('admin stats', () => {
  it('GET /operator aggregates the 7-day operator/app split', async () => {
    dispatchSql(queryMock, [
      [/FROM rides/, rows([
        {
          day: new Date('2026-07-01T00:00:00Z'),
          source: 'operator',
          total: '10',
          accepted: '8',
          completed: '7',
          auto_cancelled: '1',
          avg_accept_s: '42.5',
        },
        {
          day: new Date('2026-07-01T00:00:00Z'),
          source: 'app',
          total: '30',
          accepted: '24',
          completed: '20',
          auto_cancelled: '2',
          avg_accept_s: null,
        },
      ])],
    ]);
    handle = await startTestApp('/admin/stats', adminStatsRouter, ADMIN);
    const res = await api(handle.baseUrl, 'GET', '/admin/stats/operator');
    expect(res.status).toBe(200);
    expect(res.body.summary).toMatchObject({
      windowDays: 7,
      total: 40,
      totalApp: 30,
      totalOperator: 10,
      accepted: 32,
      completed: 27,
      autoCancelled: 3,
      acceptanceRate: 0.8,
    });
    expect(res.body.days).toHaveLength(2);
    expect(res.body.days[0]).toMatchObject({ day: '2026-07-01', source: 'operator', total: 10 });
  });
});

describe('admin document requirements', () => {
  async function start() {
    handle = await startTestApp(
      '/admin/document-requirements',
      adminDocumentRequirementsRouter,
      ADMIN,
    );
    return handle;
  }

  it('GET / lists every type with its stage', async () => {
    docReqSvcMock.getDocumentRequirements.mockResolvedValue([
      { type: 'carte_grise', stage: 'application' },
    ]);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/admin/document-requirements');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ type: 'carte_grise', stage: 'application' }]);
  });

  it('PUT /:type moves a document to another stage and audits it', async () => {
    docReqSvcMock.updateDocumentRequirement.mockResolvedValue({
      type: 'assurance',
      stage: 'online',
    });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'PUT', '/admin/document-requirements/assurance', {
      stage: 'online',
    });
    expect(res.status).toBe(200);
    expect(docReqSvcMock.updateDocumentRequirement).toHaveBeenCalledWith(
      'admin-1',
      'assurance',
      'online',
    );
    expect(auditMock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'document_requirement.update' }),
    );
  });

  it('PUT /:type rejects an unknown type (400 invalid_type)', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'PUT', '/admin/document-requirements/passport', {
      stage: 'application',
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('invalid_type');
  });

  it('PUT /:type rejects an unknown stage', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'PUT', '/admin/document-requirements/assurance', {
      stage: 'whenever',
    });
    expect(res.status).toBe(400);
  });
});

describe('admin jobs', () => {
  async function start() {
    handle = await startTestApp('/admin/jobs', adminJobsRouter, ADMIN);
    return handle;
  }

  it('POST /process-recurring runs the recurring processor', async () => {
    jobsMocks.processOccurrences.mockResolvedValue({ created: 2 });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/admin/jobs/process-recurring');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ created: 2 });
  });

  it('POST /compute-heatmap recomputes the cells', async () => {
    jobsMocks.compute.mockResolvedValue({ cells: 120 });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/admin/jobs/compute-heatmap');
    expect(res.status).toBe(200);
    expect(jobsMocks.compute).toHaveBeenCalled();
  });

  it('POST /expire-road-reports expires stale reports', async () => {
    jobsMocks.expireOld.mockResolvedValue({ expired: 3 });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/admin/jobs/expire-road-reports');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ expired: 3 });
  });

  it('POST /reap-going-home reaps stale sessions', async () => {
    jobsMocks.reapStaleSessions.mockResolvedValue(undefined);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/admin/jobs/reap-going-home');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('POST /expire-documents expires documents and suspends captains', async () => {
    jobsMocks.expireDocumentsAndSuspendCaptains.mockResolvedValue({ suspended: 1 });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/admin/jobs/expire-documents');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ suspended: 1 });
  });

  it('POST /partner-fraud-scan freezes suspicious earnings', async () => {
    jobsMocks.scanPartnerEarnings.mockResolvedValue({ frozen: 5 });
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'POST', '/admin/jobs/partner-fraud-scan');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ frozen: 5 });
  });

  it('GET /expiring-documents defaults to a 14-day horizon', async () => {
    jobsMocks.listExpiringSoon.mockResolvedValue([]);
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/admin/jobs/expiring-documents');
    expect(res.status).toBe(200);
    expect(jobsMocks.listExpiringSoon).toHaveBeenCalledWith(14);
  });

  it('GET /expiring-documents caps the horizon at 90 days (400)', async () => {
    const { baseUrl } = await start();
    const res = await api(baseUrl, 'GET', '/admin/jobs/expiring-documents?days=120');
    expect(res.status).toBe(400);
  });
});
