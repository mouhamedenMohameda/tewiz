/**
 * Ce qui autorise un Captain à passer en ligne — et ce qui ne l'autorise plus.
 *
 * Deux verrous ont été posés puis retirés, chacun pour une raison qu'il faut
 * garder écrite quelque part :
 *
 *   - les DOCUMENTS ('online') bloquaient la route. L'exigence tombait
 *     rétroactivement sur des Captains déjà acceptés, qui roulaient la veille
 *     et se retrouvaient dehors pour une pièce jamais réclamée d'eux. Le
 *     mécanisme reste (les ops peuvent replacer une pièce en 'online'), mais
 *     par défaut plus rien ne bloque.
 *
 *   - la VÉRIFICATION du véhicule bloquait aussi. Elle imposait une seconde
 *     attente juste après le "oui", là où l'ancien parcours laissait démarrer
 *     tout de suite. Le contrôle est passé en aval.
 *
 * Ces tests existent pour qu'un futur « durcissons un peu » repasse devant ces
 * raisons plutôt que de rejouer la régression.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DocumentType } from '@tewiz/shared-types';

const { poolQueryMock, stageTypesMock } = vi.hoisted(() => ({
  poolQueryMock: vi.fn(),
  stageTypesMock: vi.fn(),
}));

vi.mock('../src/db/pool.js', () => ({
  pool: { query: poolQueryMock },
  withTx: vi.fn(),
}));
vi.mock('../src/modules/admin/document-requirements.service.js', () => ({
  getDocumentTypesForStage: stageTypesMock,
}));

import { getOnboardingStatus } from '../src/modules/captain/onboarding.service.js';

const VEHICLE = {
  id: 'v1', plate: 'AA-123-BB', brand: 'Toyota', model: 'Corolla',
  year: 2015, color: 'blanc', seats: 4, vehicle_type: 'car' as const,
  verified_at: null as Date | null,
};

/** Route les SELECT vers la bonne réponse selon la table interrogée. */
function db(opts: {
  fullName?: string | null;
  vehicle?: typeof VEHICLE | null;
  docs?: { type: DocumentType; status: string; expires_at: Date | null }[];
}) {
  const { fullName = 'Sidi Ould Ahmed', vehicle = VEHICLE, docs = [] } = opts;
  poolQueryMock.mockImplementation(async (sql: string) => {
    if (/FROM users/i.test(sql)) return { rows: [{ full_name: fullName }], rowCount: 1 };
    if (/FROM vehicles/i.test(sql)) {
      return { rows: vehicle ? [vehicle] : [], rowCount: vehicle ? 1 : 0 };
    }
    if (/application_documents/i.test(sql)) return { rows: docs, rowCount: docs.length };
    return { rows: [], rowCount: 0 };
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  stageTypesMock.mockResolvedValue(new Set<DocumentType>());
});

describe('getOnboardingStatus', () => {
  it('laisse rouler un véhicule déclaré mais pas encore vérifié', async () => {
    db({ vehicle: { ...VEHICLE, verified_at: null } });
    const s = await getOnboardingStatus('cap-1');
    expect(s.vehicle?.verifiedAt).toBeNull();
    expect(s.canGoOnline).toBe(true);
  });

  it("n'exige aucun document par défaut — le cas qui bloquait les Captains déjà acceptés", async () => {
    db({ vehicle: { ...VEHICLE, verified_at: new Date() }, docs: [] });
    const s = await getOnboardingStatus('cap-1');
    expect(s.onlineGaps).toEqual([]);
    expect(s.canGoOnline).toBe(true);
  });

  it('refuse tant qu\'aucun véhicule n\'est déclaré', async () => {
    db({ vehicle: null });
    const s = await getOnboardingStatus('cap-1');
    expect(s.canGoOnline).toBe(false);
  });

  it('refuse sans nom — les passagers doivent voir quelqu\'un', async () => {
    db({ fullName: null });
    const s = await getOnboardingStatus('cap-1');
    expect(s.canGoOnline).toBe(false);
  });

  it('rebloque si les ops replacent une pièce en « online » et qu\'elle manque', async () => {
    stageTypesMock.mockResolvedValue(new Set<DocumentType>(['assurance']));
    db({ docs: [] });
    const s = await getOnboardingStatus('cap-1');
    expect(s.onlineGaps).toEqual([{ type: 'assurance', reason: 'missing' }]);
    expect(s.canGoOnline).toBe(false);
  });

  it('traite une pièce « online » périmée comme manquante', async () => {
    stageTypesMock.mockResolvedValue(new Set<DocumentType>(['assurance']));
    db({
      docs: [{
        type: 'assurance', status: 'approved',
        expires_at: new Date(Date.now() - 86_400_000),
      }],
    });
    const s = await getOnboardingStatus('cap-1');
    expect(s.onlineGaps).toEqual([{ type: 'assurance', reason: 'expired' }]);
  });
});
