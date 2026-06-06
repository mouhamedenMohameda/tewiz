export function khoumsToMru(k: number): number {
  return k / 5;
}

export function formatMru(k: number): string {
  const mru = khoumsToMru(k);
  return `${Math.round(mru)} MRU`;
}
