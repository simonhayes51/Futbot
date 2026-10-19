#!/usr/bin/env node
/** FUT.GG context for Futbot. No Discord sends, EA access, or database writes. */
import {readFile, writeFile, mkdir, rename, readdir, stat} from 'node:fs/promises';
import {resolve, dirname, join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {parseArgs} from 'node:util';

const SITE = 'https://www.fut.gg', R2 = 'https://r2.fut.gg';
const number = v => typeof v === 'number' && Number.isFinite(v) ? v : null;
const id = v => /^(?:[1-9]\d*)$/.test(String(v ?? '')) ? String(v) : null;
const stamp = v => Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null;
const list = v => Array.isArray(v) ? v : [];
const object = v => v && typeof v === 'object' && !Array.isArray(v) ? v : {};
const text = v => typeof v === 'string' ? v.slice(0, 500) : null;
const data = p => p?.data ?? p;
export const newStore = (year = 27) => ({year, snapshots: new Map(), errors: []});
function save(store, key, kind, payload, at, path) {
  const capturedAt = stamp(at);
  if (!capturedAt) { store.errors.push({path, reason: 'missing_capture_time'}); return; }
  const old = store.snapshots.get(key);
  if (!old || Date.parse(capturedAt) >= Date.parse(old.capturedAt))
    store.snapshots.set(key, {kind, payload, capturedAt, path});
}

// Whitelist the responses and output fields we need; never export raw HAR
// headers, cookies, signed URLs, community usernames or personal club data.
export function acceptPayload(store, rawUrl, payload, at) {
  const u = new URL(rawUrl), p = u.pathname, y = store.year;
  if (!['www.fut.gg', 'r2.fut.gg'].includes(u.hostname)) return;
  let m;
  if (u.hostname === 'r2.fut.gg' && p === `/${y}/manifest.json`)
    save(store, 'manifest', 'manifest', payload, at, p);
  else if (u.hostname === 'r2.fut.gg' && new RegExp(`^/${y}/all-evolutions\\.v1\\.[a-f0-9]+\\.json$`).test(p))
    save(store, 'evolutions', 'evolutions', payload, at, p);
  else if (p === `/api/fut/gallery/fc${y}/hub/`)
    save(store, 'gallery', 'gallery', payload, at, p);
  else if ((m = p.match(/^\/api\/fut\/metarank\/player\/(\d+)\/$/)) && u.searchParams.get('game') === String(y))
    save(store, `roles:${m[1]}`, 'roles', {cardId: m[1], ...object(data(payload))}, at, p);
  else if ((m = p.match(/^\/api\/fut\/tier-list\/player-tier\/(\d+)\/(\d+)\/$/)) && Number(m[1]) === y)
    save(store, `tier:${m[2]}`, 'tier', {cardId: m[2], ...object(data(payload))}, at, p);
  else if ((m = p.match(/^\/api\/fut\/players\/(\d+)\/(\d+)\/chemistry-style\/$/)) && Number(m[1]) === y)
    save(store, `chemistry:${m[2]}`, 'chemistry', {cardId: m[2], ...object(data(payload))}, at, p);
  else if ((m = p.match(/^\/api\/fut\/players\/v2\/all-versions\/(\d+)\/$/)))
    save(store, `versions:${m[1]}`, 'versions', {basePlayerId: m[1], rows: list(data(payload))}, at, p);
  else if ((m = p.match(/^\/api\/fut\/player-prices\/(\d+)\/(\d+)\/$/)) && Number(m[1]) === y)
    save(store, `detail:${m[2]}`, 'detail', {cardId: m[2], ...object(data(payload))}, at, p);
  else if ((m = p.match(/^\/api\/fut\/evolutions\/v2\/(\d+)\/paths\/v2\/(\d+)\/$/)) && Number(m[1]) === y) {
    const filter = ['player_item_ea_ids', 'number_of_evolutions__lte', 'number_of_evolutions__gte']
      .map(k => u.searchParams.get(k) ?? '').join(':');
    save(store, `paths:${m[2]}:${filter}`, 'paths', {basePlayerId: m[2], ...object(payload)}, at, p);
  } else if (p === '/api/gg-club/community/holograph/')
    save(store, 'variants', 'variants', payload, at, p);
}
export async function loadHar(store, filename) {
  const har = JSON.parse(await readFile(filename, 'utf8'));
  if (!Array.isArray(har?.log?.entries)) throw new Error('Invalid HAR: ' + filename);
  for (const entry of har.log.entries) {
    if (![200, 304].includes(entry.response?.status)) continue;
    const content = entry.response?.content;
    if (!content?.text) continue;
    const raw = content.encoding === 'base64' ? Buffer.from(content.text, 'base64').toString('utf8') : content.text;
    let payload;
    try { payload = JSON.parse(raw); } catch { continue; }
    try { acceptPayload(store, entry.request.url, payload, entry.startedDateTime); }
    catch { /* unrelated or malformed captured response */ }
  }
}
const source = s => ({path: s.path, capturedAt: s.capturedAt});
const fresh = (at, now, maxAgeMs) => { const age = now - Date.parse(at); return age >= -60_000 && age <= maxAgeMs; };
export function evolutionStatus(e, now) {
  if (e.isExpired === true) return 'expired';
  const end = stamp(e.endSubmissionTime) ?? stamp(e.endTime);
  return !end ? 'unknown' : Date.parse(end) <= now ? 'expired' : 'open';
}
function cleanPricePoints(rows, dateKey, priceKey) {
  return list(rows).flatMap(r => stamp(r[dateKey]) && number(r[priceKey]) > 0
    ? [{at: stamp(r[dateKey]), price: r[priceKey]}] : []);
}
export function buildReport(store, {now = Date.now(), platform = 'ps5', mode = 'har_replay', maxAgeMs = 6 * 3600_000, maxCards = 200} = {}) {
  const report = {schemaVersion: 1, mode, gameYear: store.year, platform,
    generatedAt: new Date(now).toISOString(), evidenceMaxAgeMinutes: maxAgeMs / 60_000,
    tradingSignal: false, requiresFreshPriceAndTradingChecks: true,
    evolutions: [], watchCandidates: [], gallery: [], playerContext: {}, variants: [], evolutionPaths: [],
    sources: [], errors: [...store.errors]};
  const cards = new Map();
  const context = n => report.playerContext[n] ??= {cardId: n};
  const candidate = n => { if (!cards.has(n)) cards.set(n, {cardId: n, reasons: []}); return cards.get(n); };
  for (const s of store.snapshots.values()) {
    const d = object(s.kind === 'paths' ? s.payload : data(s.payload)), usable = fresh(s.capturedAt, now, maxAgeMs);
    report.sources.push({...source(s), kind: s.kind, fresh: usable});
    if (s.kind === 'evolutions') {
      for (const e of list(data(s.payload))) {
        if (String(e.game) !== String(store.year) || !id(e.id)) continue;
        const status = evolutionStatus(e, now), def = {id: String(e.id), name: text(e.name),
          createdAt: stamp(e.createdAt), closesAt: stamp(e.endSubmissionTime) ?? stamp(e.endTime),
          status, coinsCost: number(e.coinsCost), pointsCost: number(e.pointsCost),
          requirements: list(e.requirementsText).map(r => ({label: text(r.label), value: text(String(r.value ?? ''))})),
          eligibleCardIds: list(e.eligiblePlayerItemIds).map(id).filter(Boolean),
          trendingBaseCardIds: [...new Set(list(e.trendingPlayersIds).flatMap(v => {
            const m = String(v).match(/^(\d+)(?:_\d+)*$/); return m && id(m[1]) ? [m[1]] : [];
          }))], eligibilityListIsComplete: false, source: source(s), fresh: usable};
        report.evolutions.push(def);
        if (status !== 'open' || !usable) continue;
        for (const [ids, reason] of [[def.eligibleCardIds, 'listed_eligible'], [def.trendingBaseCardIds, 'listed_trending_path']])
          for (const n of ids) candidate(n).reasons.push({kind: reason, evolutionId: def.id, evolutionName: def.name,
            eligibilityConfirmed: reason === 'listed_eligible', capturedAt: s.capturedAt});
      }
    } else if (s.kind === 'gallery') {
      const names = new Map(list(d.categories).flatMap(c => list(c.sets).map(set => [String(set.id), set])));
      for (const set of list(d.sets)) for (const tier of list(set.costTiers)) {
        const cost = number(tier.cost), tokens = number(tier.tokens), meta = names.get(String(set.setId));
        report.gallery.push({setId: String(set.setId), name: text(meta?.name) ?? `Set ${set.setId}`, grade: text(tier.grade),
          cost, tokens, coinsPerToken: cost !== null && cost > 0 && tokens > 0 ? Math.ceil(cost / tokens) : null,
          zeroOrMissingCostRequiresReview: cost === null || cost <= 0,
          items: list(tier.items).filter(r => id(r.eaId)).map(r => ({cardId: String(r.eaId), capturedPrice: number(r.price)})),
          computedAt: stamp(d.computedAt), source: source(s), fresh: usable});
      }
    } else if (s.kind === 'roles') {
      context(String(s.payload.cardId)).roles = {source: source(s), fresh: usable,
        scores: list(d.scores).filter(r => number(r.score) !== null).map(r => ({roleId: r.role,
          chemistryStyleId: r.chemistryStyle, score: r.score, rank: number(r.rank),
          rolePlus: r.isPlus === true, rolePlusPlus: r.isPlusPlus === true})).sort((a,b) => b.score - a.score)};
    } else if (s.kind === 'tier') {
      context(String(s.payload.cardId)).communityTier = {source: source(s), fresh: usable,
        tier: text(d.tierLetter), votes: number(d.count), breakdown: Object.fromEntries(['s','a','b','c','d','f'].map(k => [k, number(d.breakdown?.[k])]))};
    } else if (s.kind === 'chemistry') {
      context(String(s.payload.cardId)).chemistryVotes = {source: source(s), fresh: usable,
        styles: Object.entries(object(d.chemistryVotes)).filter(([n,v]) => id(n) && number(v) >= 0)
          .map(([n,v]) => ({chemistryStyleId: n, votes: v})).sort((a,b) => b.votes - a.votes)};
    } else if (s.kind === 'versions') {
      for (const r of s.payload.rows) {
        if (String(r.game) !== String(store.year) || !id(r.eaId) || r.playerType !== 'players') continue;
        Object.assign(context(String(r.eaId)), {basePlayerId: s.payload.basePlayerId,
          name: text(r.nickname) || [r.firstName, r.lastName].filter(Boolean).join(' ').slice(0,150),
          rating: number(r.overall), versionSource: source(s)});
      }
    } else if (s.kind === 'detail') {
      if (String(d.currentPrice?.platform) !== platform) continue;
      const n = String(s.payload.cardId);
      context(n).capturedMarketEvidence = {source: source(s), fresh: usable,
        sourcePriceUpdatedAt: stamp(d.currentPrice?.priceUpdatedAt),
        historicalBin: cleanPricePoints(d.history, 'date', 'price'),
        recentBin: cleanPricePoints(d.momentum?.lastUpdates, 'updatedAt', 'bin'),
        completedSales: cleanPricePoints(d.completedAuctions, 'soldDate', 'soldPrice'),
        priceRange: {min: number(d.priceRange?.minPrice), max: number(d.priceRange?.maxPrice)},
        overview: Object.fromEntries(['averageBin','cheapestSale','discardValue','yesterdayAverageBin'].map(k => [k, number(d.overview?.[k])])),
        neverImportAsLivePrice: true};
    } else if (s.kind === 'paths') {
      report.evolutionPaths.push({basePlayerId: s.payload.basePlayerId, source: source(s), fresh: usable,
        capturedCount: list(d.data).length, total: number(d.total), next: number(d.next),
        paths: list(d.data).map(r => ({startCardId: id(r.path?.[0]?.eaId), endCardId: id(r.path?.at(-1)?.eaId),
          coinsCost: number(r.coinsCost), pointsCost: number(r.pointsCost), expired: r.isExpired === true,
          evolutionNames: list(r.evolutions).map(e => text(e.name)).filter(Boolean),
          upgrades: list(r.upgrades?.text).map(v => ({label: text(v.label), value: text(String(v.value ?? ''))}))}))});
    } else if (s.kind === 'variants') {
      report.variants = list(d.catalogue).filter(r => id(r.eaId)).map(r => ({cardId: String(r.eaId),
        standardCardId: id(r.standardItemEaId), name: text(r.commonName), finish: text(r.finish),
        communityOwnerCount: number(r.ownerCount), capturedPrice: number(r.price),
        priceUpdatedAt: stamp(r.priceUpdatedAt), source: source(s),
        ownershipIsNotMarketSupply: true}));
    }
  }
  report.watchCandidates = [...cards.values()].sort((a,b) => b.reasons.length - a.reasons.length || a.cardId.localeCompare(b.cardId))
    .slice(0, maxCards).map(c => ({...c, name: report.playerContext[c.cardId]?.name ?? null, tradingSignal: false}));
  report.gallery.sort((a,b) => (a.coinsPerToken ?? Infinity) - (b.coinsPerToken ?? Infinity));
  report.summary = {evolutions: report.evolutions.length, openEvolutions: report.evolutions.filter(e => e.status === 'open' && e.fresh).length,
    watchCandidates: report.watchCandidates.length, galleryGrades: report.gallery.length,
    playerContexts: Object.keys(report.playerContext).length, variants: report.variants.length};
  return report;
}

// Futbot can consume this after its existing freshness/risk/history checks.
// Missing/stale context returns null; it must never invent permission to buy.
export function contextForCard(report, cardId, {year = 27, platform = 'ps5', now = Date.now(), maxAgeMs = 6 * 3600_000} = {}) {
  if (report?.schemaVersion !== 1 || report.gameYear !== year || report.platform !== platform) return null;
  const reasons = (report.watchCandidates?.find(c => c.cardId === String(cardId))?.reasons ?? [])
    .filter(r => {
      const e = report.evolutions?.find(e => e.id === r.evolutionId);
      return fresh(r.capturedAt, now, maxAgeMs) && e?.status === 'open' && e.closesAt && Date.parse(e.closesAt) > now;
    });
  const player = report.playerContext?.[String(cardId)];
  const details = Object.fromEntries(Object.entries(player ?? {}).filter(([,v]) => v?.source && fresh(v.source.capturedAt, now, maxAgeMs)));
  return !reasons.length && !Object.keys(details).length ? null : {cardId: String(cardId), reasons, ...details, tradingSignal: false};
}

export async function collectLive(store, {cardIds = [], basePlayerIds = [], fetcher = fetch} = {}) {
  async function get(url) {
    try {
      const response = await fetcher(url, {headers: {accept: 'application/json'}, signal: AbortSignal.timeout(20_000)});
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const payload = await response.json();
      acceptPayload(store, url, payload, new Date().toISOString());
      return payload;
    } catch (e) {
      store.errors.push({path: new URL(url).pathname, reason: text(e.message)});
      return null;
    }
  }
  const manifest = await get(`${R2}/${store.year}/manifest.json`);
  const hash = manifest?.['all-evolutions'];
  if (typeof hash === 'string' && /^[a-f0-9]{8,64}$/.test(hash))
    await get(`${R2}/${store.year}/all-evolutions.v1.${hash}.json`);
  else store.errors.push({path: 'all-evolutions', reason: 'manifest_missing_version'});
  await get(`${SITE}/api/fut/gallery/fc${store.year}/hub/`);
  for (const n of cardIds.slice(0,10)) {
    await get(`${SITE}/api/fut/metarank/player/${n}/?game=${store.year}`);
    await get(`${SITE}/api/fut/tier-list/player-tier/${store.year}/${n}/`);
    await get(`${SITE}/api/fut/players/${store.year}/${n}/chemistry-style/`);
  }
  for (const n of basePlayerIds.slice(0,10)) await get(`${SITE}/api/fut/players/v2/all-versions/${n}/`);
  // Signed price endpoints and private club feeds are intentionally absent.
}

export async function enrichFromPriceDb(report, connectionString) {
  const {default: pg} = await import('pg');
  const pool = new pg.Pool({connectionString, max: 1, statement_timeout: 8000,
    connectionTimeoutMillis: 10000, options: '-c default_transaction_read_only=on', application_name: 'futbot-context-reader'});
  try {
    const ids = report.watchCandidates.map(c => c.cardId);
    const table = report.platform === 'pc' ? 'public.futbot_pc_bin_history' : 'public.futgg_bin_history';
    for (let offset = 0; offset < ids.length; offset += 20) {
      const {rows} = await pool.query(`SELECT p.source_card_id::text AS id,
        COALESCE(p.display_name,p.name,p.full_name) AS name,p.rating,p.is_tradeable,
        h.lowest_bin::int AS price,h.captured_at AS at
        FROM public.futgg_players p LEFT JOIN LATERAL (
          SELECT lowest_bin,captured_at FROM ${table}
          WHERE source_card_id=p.source_card_id AND game_year=$1 AND platform=$2
            AND lowest_bin>0 AND captured_at>=now()-interval '15 minutes' AND captured_at<=now()
          ORDER BY captured_at DESC,id DESC LIMIT 1
        ) h ON true WHERE p.game_year=$1 AND p.is_active=true AND p.source_card_id=ANY($3::bigint[])`,
        [report.gameYear, report.platform, ids.slice(offset, offset+20)]);
      for (const row of rows) {
        const c = report.watchCandidates.find(c => c.cardId === row.id);
        if (!c) continue;
        c.name = row.name; c.rating = row.rating;
        c.observedBin = row.is_tradeable === false || !row.at ? null : {price: row.price, capturedAt: new Date(row.at).toISOString(), source: 'existing_price_database', timestampIsCaptureTime: true};
      }
    }
  } finally { await pool.end(); }
}

export async function main(argv = process.argv.slice(2)) {
  const {values: args} = parseArgs({args: argv, options: {
    har: {type:'string', multiple:true}, live: {type:'boolean'}, card: {type:'string', multiple:true},
    'base-player': {type:'string', multiple:true}, 'with-prices': {type:'boolean'},
    out: {type:'string'}, year: {type:'string'}, platform: {type:'string'}, help: {type:'boolean'}
  }});
  if (args.help || (!args.live && !args.har?.length)) {
    console.log('node scripts/futgg-context.mjs --har /path/to/captures [--har another.har] [--with-prices]\nnode scripts/futgg-context.mjs --live [--card 50609974] [--base-player 278326] [--with-prices]\nOptions: --year 27 --platform ps5|pc --out /data/futgg-context/context.json');
    return;
  }
  const year = Number(args.year ?? process.env.GAME_YEAR ?? 27), platform = args.platform ?? process.env.PLATFORM ?? 'ps5';
  if (!Number.isInteger(year) || year < 20 || year > 99 || !['ps5','pc'].includes(platform)) throw new Error('Invalid year/platform');
  const cardIds = args.card ?? [], basePlayerIds = args['base-player'] ?? [];
  if ([...cardIds,...basePlayerIds].some(n => !id(n)) || cardIds.length > 10 || basePlayerIds.length > 10) throw new Error('Use numeric IDs; maximum ten cards/base players per run');
  const store = newStore(year);
  for (const target of args.har ?? []) {
    if ((await stat(target)).isDirectory()) {
      for (const name of (await readdir(target)).filter(n => n.endsWith('.har')).sort()) await loadHar(store, join(target, name));
    } else await loadHar(store, target);
  }
  if (args.live) await collectLive(store, {cardIds, basePlayerIds});
  const report = buildReport(store, {platform, mode: args.live ? (args.har?.length ? 'mixed' : 'live') : 'har_replay'});
  if (args['with-prices']) {
    if (!process.env.PRICE_DATABASE_URL) throw new Error('PRICE_DATABASE_URL is required for --with-prices');
    await enrichFromPriceDb(report, process.env.PRICE_DATABASE_URL);
  }
  const out = resolve(args.out ?? `.futgg-context/${year}-${platform}/context.json`);
  await mkdir(dirname(out), {recursive:true});
  const temporary = out + '.' + process.pid + '.tmp';
  await writeFile(temporary, JSON.stringify(report, null, 2) + '\n', {mode:0o600});
  await rename(temporary, out);
  console.log(JSON.stringify({output:out, mode:report.mode, ...report.summary, errors:report.errors}));
  if (args.live && report.errors.length) process.exitCode = 1;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  main().catch(error => {console.error('Futbot context: ' + error.message); process.exitCode = 1;});
