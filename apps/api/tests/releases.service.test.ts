import { beforeEach, describe, expect, it, vi } from 'vitest';

// releases.service maps app_releases rows to the API shape, hosts the "latest
// build" query, and derives a safe download filename. We mock the pool and the
// storage provider so the pure mappers and the delete-then-unlink flow can be
// asserted without a DB or disk.

const { queryMock, storageDeleteMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  storageDeleteMock: vi.fn(),
}));

vi.mock('../src/db/pool.js', () => ({
  pool: { query: queryMock },
}));
vi.mock('../src/modules/storage/local-disk.js', () => ({
  defaultStorage: { delete: storageDeleteMock },
}));

import {
  getLatestRelease,
  listReleases,
  insertRelease,
  deleteRelease,
  toPublicJson,
  downloadFilename,
  type AppRelease,
} from '../src/modules/releases/releases.service.js';

const dbRow = {
  id: 'rel-1',
  platform: 'android',
  version_name: '1.2.0',
  // bigint columns come back as strings from node-postgres.
  version_code: '42',
  package_name: 'com.tewiz.app',
  storage_key: 'releases/abc.apk',
  size_bytes: '10485760',
  notes: 'hotfix',
  uploaded_by: 'admin-1',
  created_at: new Date('2026-07-01T10:00:00.000Z'),
};

const release: AppRelease = {
  id: 'rel-1',
  platform: 'android',
  versionName: '1.2.0',
  versionCode: 42,
  packageName: 'com.tewiz.app',
  storageKey: 'releases/abc.apk',
  sizeBytes: 10485760,
  notes: 'hotfix',
  uploadedBy: 'admin-1',
  createdAt: '2026-07-01T10:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('rowToRelease mapping (via getLatestRelease)', () => {
  it('coerces bigint strings to numbers and normalises the Date to ISO', async () => {
    queryMock.mockResolvedValue({ rows: [dbRow], rowCount: 1 });

    const r = await getLatestRelease();

    expect(r).toEqual(release);
    // versionCode / sizeBytes must be real numbers, not the raw pg strings.
    expect(typeof r!.versionCode).toBe('number');
    expect(typeof r!.sizeBytes).toBe('number');
  });

  it('returns null when there is no build yet', async () => {
    queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
    expect(await getLatestRelease()).toBeNull();
  });

  it('defaults nullable columns (packageName, notes, uploadedBy) to null', async () => {
    queryMock.mockResolvedValue({
      rows: [{ ...dbRow, package_name: null, notes: null, uploaded_by: null }],
      rowCount: 1,
    });

    const r = await getLatestRelease();

    expect(r!.packageName).toBeNull();
    expect(r!.notes).toBeNull();
    expect(r!.uploadedBy).toBeNull();
  });

  it('accepts a string created_at without wrapping it in a Date', async () => {
    queryMock.mockResolvedValue({
      rows: [{ ...dbRow, created_at: '2026-07-01T10:00:00.000Z' }],
      rowCount: 1,
    });

    const r = await getLatestRelease();
    expect(r!.createdAt).toBe('2026-07-01T10:00:00.000Z');
  });
});

describe('listReleases', () => {
  it('maps every row', async () => {
    queryMock.mockResolvedValue({ rows: [dbRow, { ...dbRow, id: 'rel-2' }], rowCount: 2 });
    const list = await listReleases();
    expect(list).toHaveLength(2);
    expect(list[1].id).toBe('rel-2');
  });
});

describe('insertRelease', () => {
  it('passes fields positionally and returns the mapped row', async () => {
    queryMock.mockResolvedValue({ rows: [dbRow], rowCount: 1 });

    const r = await insertRelease({
      versionName: '1.2.0',
      versionCode: 42,
      packageName: 'com.tewiz.app',
      storageKey: 'releases/abc.apk',
      sizeBytes: 10485760,
      notes: 'hotfix',
      uploadedBy: 'admin-1',
    });

    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toMatch(/INSERT INTO app_releases/);
    expect(params).toEqual([
      '1.2.0',
      42,
      'com.tewiz.app',
      'releases/abc.apk',
      10485760,
      'hotfix',
      'admin-1',
    ]);
    expect(r).toEqual(release);
  });
});

describe('deleteRelease', () => {
  it('returns null and never touches storage when the build is missing', async () => {
    queryMock.mockResolvedValueOnce({ rows: [], rowCount: 0 }); // getReleaseById

    const r = await deleteRelease('missing');

    expect(r).toBeNull();
    expect(storageDeleteMock).not.toHaveBeenCalled();
    // Only the lookup ran — no DELETE.
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it('deletes the row then best-effort removes the binary', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [dbRow], rowCount: 1 }) // getReleaseById
      .mockResolvedValueOnce({ rows: [], rowCount: 1 }); // DELETE
    storageDeleteMock.mockResolvedValue(undefined);

    const r = await deleteRelease('rel-1');

    expect(r).toEqual(release);
    expect(queryMock.mock.calls[1][0]).toMatch(/DELETE FROM app_releases/);
    expect(storageDeleteMock).toHaveBeenCalledWith('releases/abc.apk');
  });

  it('still resolves when the storage delete rejects (best-effort cleanup)', async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [dbRow], rowCount: 1 })
      .mockResolvedValueOnce({ rows: [], rowCount: 1 });
    storageDeleteMock.mockRejectedValue(new Error('storage down'));

    await expect(deleteRelease('rel-1')).resolves.toEqual(release);
  });
});

describe('toPublicJson', () => {
  it('exposes only public fields plus the download URL', () => {
    const json = toPublicJson(release, 'https://x/public/app/download');
    expect(json).toEqual({
      versionName: '1.2.0',
      versionCode: 42,
      sizeBytes: 10485760,
      notes: 'hotfix',
      createdAt: '2026-07-01T10:00:00.000Z',
      downloadUrl: 'https://x/public/app/download',
    });
    // Internal fields must not leak.
    expect(json).not.toHaveProperty('storageKey');
    expect(json).not.toHaveProperty('uploadedBy');
  });
});

describe('downloadFilename — Content-Disposition safety', () => {
  it('keeps a clean version string', () => {
    expect(downloadFilename(release)).toBe('app-1.2.0.apk');
  });

  it('strips characters that could inject into the header', () => {
    const evil = { ...release, versionName: '1.0"; rm -rf /\r\nSet-Cookie: x' };
    const name = downloadFilename(evil);
    // Only [A-Za-z0-9._-] survive; quotes, semicolons, slashes and CRLF are gone.
    expect(name).toBe('app-1.0rm-rfSet-Cookiex.apk');
    expect(name).not.toMatch(/["\s;/\r\n]/);
  });

  it('falls back to "latest" when the version has no safe characters', () => {
    const weird = { ...release, versionName: '???' };
    expect(downloadFilename(weird)).toBe('app-latest.apk');
  });
});
