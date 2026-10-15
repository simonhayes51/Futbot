export type Direction = 'below' | 'above';
export type Price = { cardId: string; platform: string; value: number; capturedAt: Date };
export type Card = { id: string; name: string; rating: number | null; position: string | null; rarity: string | null; club: string | null; image: string | null };
export function meetsTarget(price: number, target: number, direction: Direction) {
  return direction === 'below' ? price <= target : price >= target;
}
export function isFresh(capturedAt: Date, maxAgeMinutes: number, now = Date.now()) {
  const age = now - capturedAt.getTime();
  return Number.isFinite(age) && age >= -60_000 && age <= maxAgeMinutes * 60_000;
}
export function tradeProfit(buy: number, sell: number, quantity = 1) {
  const netPerCard = Math.floor(sell * .95);
  return { tax: (sell - netPerCard) * quantity, profit: (netPerCard - buy) * quantity, breakEven: Math.ceil(buy / .95) };
}
export const coins = (n: number) => new Intl.NumberFormat('en-GB').format(n);
export function escapeXml(s: string) { return s.replace(/[<>&"']/g, c => ({ '<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;', "'":'&apos;' }[c]!)); }
