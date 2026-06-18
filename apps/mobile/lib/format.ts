/**
 * Money formatter. All amounts in this codebase are integer MRU (ouguiyas)
 * since DB migration 0017. The historical khoums unit was removed.
 */
export function formatMru(mru: number): string {
  return `${Math.round(mru).toLocaleString('fr-FR')} MRU`;
}
