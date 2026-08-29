/**
 * FEATURE 14 — KYC captain (dossier + validation manuelle).
 *
 * The gate between "someone downloaded the app" and "someone is driving a
 * paying passenger". Everything the platform can be held responsible for
 * depends on this step being un-bypassable: identity, insurance, roadworthiness,
 * and the captain's consent to the terms.
 *
 * The submission is the choke point — once a dossier is 'submitted' an admin
 * reviews it, but nothing downstream re-checks completeness. So every rule that
 * matters has to hold here.
 *
 * Status per the audit: working.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { poolQueryMock, withTxMock, stageDocsMock, requirementsMock } = vi.hoisted(() => ({
  poolQueryMock: vi.fn(),
  withTxMock: vi.fn(),
  stageDocsMock: vi.fn(),
  requirementsMock: vi.fn(),
}));

vi.mock('../../src/db/pool.js', () => ({
  pool: { query: poolQueryMock, connect: vi.fn(), on: vi.fn() },
  withTx: withTxMock,
}));
vi.mock('../../src/modules/admin/document-requirements.service.js', () => ({
  getDocumentTypesForStage: stageDocsMock,
  getDocumentRequirements: requirementsMock,
}));
vi.mock('../../src/modules/storage/local-disk.js', () => ({
  defaultStorage: { put: vi.fn(), get: vi.fn(), delete: vi.fn() },
}));
vi.mock('../../src/modules/partners/partners.service.js', () => ({
  findPartnerByCode: vi.fn(), assertCaptainNeverLinked: vi.fn(),
}));

import { submitApplication } from '../../src/modules/captain/application.service.js';
import { TERMS_VERSION } from '../../src/modules/captain/terms.service.js';

/**
 * Un dossier « v3 » : le candidat n'a saisi aucun champ. Depuis la 0087 le
 * nom et le véhicule sont déclarés APRÈS l'acceptation — laisser ces colonnes
 * remplies dans la fixture masquerait une régression où le gate les
 * réclamerait de nouveau.
 */
function completeApp(overrides: Record<string, unknown> = {}) {
  return {
    id: 'app-1',
    phone: '+22246000000',
    user_id: 'user-1',
    status: 'draft',
    full_name: null,
    nni: null,
    date_of_birth: null,
    address_label: null,
    emergency_contact_name: null,
    emergency_contact_phone: null,
    whatsapp: '+22246000000',
    vehicle_plate: null,
    vehicle_brand: null,
    vehicle_model: null,
    vehicle_year: null,
    vehicle_color: null,
    vehicle_seats: null,
    vehicle_type: 'car',
    accepts_colis: false,
    accepts_long_distance: false,
    agency_code: null,
    submitted_at: null,
    reviewed_at: null,
    rejection_reason: null,
    correction_notes: null,
    created_at: new Date(),
    updated_at: new Date(),
    ...overrides,
  };
}

interface Setup {
  app?: Record<string, unknown> | null;
  consented?: boolean;
  docs?: string[];
}

function scenario(s: Setup = {}) {
  const app = s.app === null ? null : completeApp(s.app);
  const calls: { sql: string; params: any[] }[] = [];
  const client = {
    query: vi.fn(async (sql: unknown, params: any[] = []) => {
      const text = String(sql);
      calls.push({ sql: text, params });
      if (/FROM captain_applications\s+WHERE user_id = \$1[\s\S]*FOR UPDATE/i.test(text)) {
        return { rows: app ? [app] : [], rowCount: app ? 1 : 0 };
      }
      if (/FROM captain_terms_acceptances/i.test(text)) {
        return { rows: s.consented === false ? [] : [{ '?column?': 1 }], rowCount: s.consented === false ? 0 : 1 };
      }
      if (/SELECT type FROM application_documents/i.test(text)) {
        const docs = s.docs ?? ['license_front', 'carte_grise'];
        return { rows: docs.map((type) => ({ type })), rowCount: docs.length };
      }
      if (/UPDATE captain_applications\s+SET status = 'submitted'/i.test(text)) {
        return { rows: [{ ...app, status: 'submitted', submitted_at: new Date() }], rowCount: 1 };
      }
      if (/FROM application_documents\s+WHERE application_id/i.test(text)) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 0 };
    }),
    calls,
    didQuery: (re: RegExp) => calls.some((c) => re.test(c.sql)),
  };
  withTxMock.mockImplementation(async (fn: any) => fn(client));
  return client;
}

beforeEach(() => {
  vi.clearAllMocks();
  poolQueryMock.mockResolvedValue({ rows: [], rowCount: 0 });
  stageDocsMock.mockResolvedValue(['license_front', 'carte_grise']);
  requirementsMock.mockResolvedValue([]);
});

describe('a complete dossier reaches review', () => {
  it('moves the application to submitted', async () => {
    scenario();

    const app = await submitApplication('user-1');

    expect(app.status).toBe('submitted');
  });

  it('locks the row so a double submit cannot race', async () => {
    const client = scenario();

    await submitApplication('user-1');

    expect(client.calls[0]!.sql).toMatch(/FOR UPDATE/i);
  });

  it('only picks up a dossier that is still editable', async () => {
    const client = scenario();

    await submitApplication('user-1');

    // An approved or already-submitted captain must not be able to re-enter the
    // pipeline and quietly replace their reviewed papers.
    expect(client.calls[0]!.sql).toMatch(/status IN \('draft','needs_correction'\)/);
  });

  it('refuses when there is no draft to submit', async () => {
    scenario({ app: null });

    await expect(submitApplication('user-1')).rejects.toMatchObject({
      status: 404, code: 'no_draft',
    });
  });
});

describe('the consent gate', () => {
  it('refuses a submission without an accepted terms version', async () => {
    scenario({ consented: false });

    // This is the authoritative check, not the checkbox in the app. A build that
    // predates the terms screen simply cannot submit — its documents stay in the
    // draft and never reach an admin.
    const err = await submitApplication('user-1').catch((e) => e);

    expect(err).toMatchObject({ status: 403, code: 'terms_not_accepted' });
    expect(err.details).toMatchObject({ version: TERMS_VERSION });
  });

  it('checks consent for the CURRENT terms version, not just any acceptance', async () => {
    const client = scenario();

    await submitApplication('user-1');

    const consent = client.calls.find((c) => /captain_terms_acceptances/i.test(c.sql))!;
    // Re-consent must be required when the terms change; matching on user alone
    // would grandfather everyone through a revision.
    expect(consent.params).toEqual(['user-1', TERMS_VERSION]);
  });
});

describe('completeness gates', () => {
  it('demands no typed field at all', async () => {
    // Onboarding v3 : la plaque, la marque, le modèle, l'année, la couleur, le
    // nombre de places et le nom du propriétaire figurent tous sur la carte
    // grise que le candidat vient de photographier. Les lui faire recopier
    // avant même de savoir s'il est accepté coûtait ~34 taps pour un
    // « peut-être ». Épinglé pour qu'un futur « resserrons le formulaire »
    // soit une décision consciente, pas une régression.
    scenario();

    const app = await submitApplication('user-1');

    expect(app.status).toBe('submitted');
  });

  it('refuses a dossier missing a document required at the application stage', async () => {
    scenario({ docs: ['license_front'] });

    const err = await submitApplication('user-1').catch((e) => e);

    expect(err).toMatchObject({ status: 400, code: 'incomplete' });
    expect(err.details.missing).toContain('Document manquant: carte_grise');
  });

  it('reports every missing document at once, not one per round trip', async () => {
    scenario({ docs: [] });

    const err = await submitApplication('user-1').catch((e) => e);

    // Un candidat en 2G ne doit pas soumettre deux fois pour découvrir deux
    // problèmes.
    expect(err.details.missing).toEqual(expect.arrayContaining([
      'Document manquant: license_front',
      'Document manquant: carte_grise',
    ]));
  });

  it('only gates on the "application" stage, not on documents due later', async () => {
    // L'assurance et la photo du véhicule sont réclamées après l'acceptation
    // (stage 'online'). Les faire remonter ici remettrait dans la candidature
    // ce que la 0087 en a sorti.
    scenario();

    await submitApplication('user-1');

    expect(stageDocsMock).toHaveBeenCalledWith('application');
  });

  it('follows the admin-configured stage list, not a hardcoded one', async () => {
    stageDocsMock.mockResolvedValue(['license_front', 'carte_grise', 'visite_technique']);
    scenario({ docs: ['license_front', 'carte_grise'] });

    const err = await submitApplication('user-1').catch((e) => e);

    expect(err.details.missing).toContain('Document manquant: visite_technique');
  });

  it('never marks an incomplete dossier as submitted', async () => {
    const client = scenario({ docs: [] });

    await submitApplication('user-1').catch(() => {});

    expect(client.didQuery(/SET status = 'submitted'/i)).toBe(false);
  });
});

describe('WhatsApp fallback', () => {
  it('falls back to the application phone when WhatsApp is blank', async () => {
    const client = scenario({ app: { whatsapp: '' } });

    const app = await submitApplication('user-1');

    // The admin sends the generated password over WhatsApp; a blank number
    // means a captain who is approved and can never log in.
    expect(client.didQuery(/UPDATE captain_applications SET whatsapp/i)).toBe(true);
    expect(app.whatsapp).toBe('+22246000000');
  });

  it('does not overwrite a WhatsApp number the captain supplied', async () => {
    const client = scenario({ app: { whatsapp: '+22249999999' } });

    await submitApplication('user-1');

    expect(client.didQuery(/UPDATE captain_applications SET whatsapp/i)).toBe(false);
  });
});
