type JsonObject = Record<string, unknown>;
export type EvolutionWatch = {
  id: string; name: string; closesAt: string; coinsCost: number | null;
  pointsCost: number | null; eligibleCardIds: string[]; trendingCardIds: string[];
};
export type GalleryValue = {
  setId: string; name: string; grade: string; cost: number | null;
  tokens: number | null; coinsPerToken: number | null; itemCount: number; cardIds: string[];
};
export type FutggContext = { fetchedAt: Date; evolutions: EvolutionWatch[]; gallery: GalleryValue[] };
const asObject = (value: unknown): JsonObject => value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
const asList = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const asId = (value: unknown): string | null => /^[1-9]\d*$/.test(String(value ?? '')) ? String(value) : null;
const asNumber = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const nestedData = (value: unknown): unknown => asObject(value).data ?? value;

export function normaliseEvolutions(payload: unknown, now = Date.now()): EvolutionWatch[] {
  return asList(nestedData(payload)).flatMap(raw => {
    const row = asObject(raw), id = asId(row.id);
    if (!id || row.isExpired === true) return [];
    const end = row.endSubmissionTime ?? row.endTime;
    const closes = typeof end === 'string' ? Date.parse(end) : NaN;
    if (!Number.isFinite(closes) || closes <= now) return [];
    const eligibleCardIds = [...new Set(asList(row.eligiblePlayerItemIds).map(asId).filter((v): v is string => !!v))];
    const trendingCardIds = [...new Set(asList(row.trendingPlayersIds).flatMap(value => {
      const match = String(value).match(/^(\d+)(?:_\d+)*$/);
      const cardId = match && asId(match[1]);
      return cardId ? [cardId] : [];
    }))].filter(cardId => !eligibleCardIds.includes(cardId));
    return [{id, name: typeof row.name === 'string' ? row.name.slice(0, 120) : `Evolution ${id}`,
      closesAt: new Date(closes).toISOString(), coinsCost: asNumber(row.coinsCost), pointsCost: asNumber(row.pointsCost),
      eligibleCardIds, trendingCardIds}];
  }).sort((a, b) => Date.parse(a.closesAt) - Date.parse(b.closesAt));
}

export function normaliseGallery(payload: unknown): GalleryValue[] {
  const root = asObject(nestedData(payload));
  const names = new Map<string, string>();
  for (const category of asList(root.categories)) for (const set of asList(asObject(category).sets)) {
    const row = asObject(set); if (row.id != null && typeof row.name === 'string') names.set(String(row.id), row.name.slice(0, 100));
  }
  const values: GalleryValue[] = [];
  for (const set of asList(root.sets)) {
    const row = asObject(set), setId = asId(row.setId);
    if (!setId) continue;
    for (const tier of asList(row.costTiers)) {
      const value = asObject(tier), cost = asNumber(value.cost), tokens = asNumber(value.tokens);
      values.push({setId, name: names.get(setId) ?? `Set ${setId}`,
        grade: typeof value.grade === 'string' ? value.grade.slice(0, 40) : 'Unspecified',
        cost, tokens, coinsPerToken: cost !== null && cost > 0 && tokens !== null && tokens > 0 ? Math.ceil(cost / tokens) : null,
        itemCount: asList(value.items).length,
        cardIds: [...new Set(asList(value.items).map(item => asId(asObject(item).eaId)).filter((id): id is string => !!id))]});
    }
  }
  return values.sort((a, b) => (a.coinsPerToken ?? Infinity) - (b.coinsPerToken ?? Infinity));
}

async function getJson(url: string, fetcher: typeof fetch): Promise<unknown> {
  const response = await fetcher(url, {headers: {accept: 'application/json'}, signal: AbortSignal.timeout(15_000)});
  if (!response.ok) throw new Error(`FUT.GG returned HTTP ${response.status}`);
  return response.json();
}

const cache = new Map<number, {until: number; value: Promise<FutggContext>}>();
export function fetchFutggContext(year: number, fetcher: typeof fetch = fetch): Promise<FutggContext> {
  const hit = cache.get(year);
  if (hit && hit.until > Date.now()) return hit.value;
  const value = (async () => {
    const root = `https://r2.fut.gg/${year}`;
    const manifest = asObject(await getJson(`${root}/manifest.json`, fetcher));
    const hash = manifest['all-evolutions'];
    if (typeof hash !== 'string' || !/^[a-f0-9]{8,64}$/.test(hash)) throw new Error('FUT.GG did not return an Evolution data version.');
    const [evolutions, gallery] = await Promise.all([
      getJson(`${root}/all-evolutions.v1.${hash}.json`, fetcher),
      getJson(`https://www.fut.gg/api/fut/gallery/fc${year}/hub/`, fetcher),
    ]);
    return {fetchedAt: new Date(), evolutions: normaliseEvolutions(evolutions), gallery: normaliseGallery(gallery)};
  })().catch(error => { cache.delete(year); throw error; });
  cache.set(year, {until: Date.now() + 5 * 60_000, value});
  return value;
}
