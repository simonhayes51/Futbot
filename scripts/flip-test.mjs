#!/usr/bin/env node
// Private BIN-only experiment. No Discord, web scraping, AI, or database writes.
import {readFile, mkdir, writeFile, rename, open, unlink} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';

const HOUR = 3_600_000, DAY = 24 * HOUR;
export const eligible = card => card.price > 20_000 || card.rating > 85;
const median = values => quantile(values, 0.5);
function quantile(values, fraction) {
  const sorted = [...values].sort((a, b) => a - b);
  if (!sorted.length) return NaN;
  const at = (sorted.length - 1) * fraction, lo = Math.floor(at);
  return sorted[lo] + (sorted[Math.ceil(at)] - sorted[lo]) * (at - lo);
}
const change = (value, baseline) => value / baseline - 1;
export function emptyState(year = 27, platform = 'ps5') {
  return {version: 1, year, platform, selectedAt: 0, ids: [], cards: {}, pauseUntil: 0, calls: []};
}

// Hourly medians for history; three separate fresh observations for confirmation.
// Weight each source observation once, even if the worker runs repeatedly.
export function ingest(state, rows, now) {
  const fresh = [];
  for (const row of rows) {
    const at = new Date(row.at).getTime(), price = Number(row.price);
    if (!Number.isFinite(at) || !Number.isFinite(price) || price <= 0 ||
        at > now || now - at > 30 * 60_000) continue;
    const id = String(row.id);
    const card = state.cards[id] ??= {history: [], recent: [], lastAlert: 0};
    const previous = card.recent.at(-1);
    if (previous && (at < previous.at || (at === previous.at && price !== previous.price))) continue;
    card.name = row.name; card.rating = Number(row.rating); card.rarity = row.rarity;
    if (at > (card.recent.at(-1)?.at ?? 0)) {
      card.recent.push({at, price}); card.recent = card.recent.slice(-3);
      const bucket = Math.floor(at / HOUR) * HOUR;
      let point = card.history.at(-1);
      if (!point || point.at !== bucket) card.history.push(point = {at: bucket, values: []});
      // At most one sample per 15-minute source-time slot. Bound state size.
      const slot = Math.floor(at / 900_000) % 4;
      point.values[slot] = price;
      card.history = card.history.filter(p => p.at >= now - 7 * DAY);
    }
    card.at = at; card.price = price;
    fresh.push({id, ...card});
  }
  return fresh;
}
function hourly(card, now) {
  return card.history.filter(p => p.at < Math.floor(now / HOUR) * HOUR)
    .map(p => ({at: p.at, price: median(p.values.filter(v => Number.isFinite(v) && v > 0))}));
}

export function marketCheck(cards, now) {
  const changes = [];
  for (const card of cards) {
    const h = hourly(card, now);
    const baseline = h.filter(p => p.at >= now - 3 * HOUR && p.at <= now - HOUR);
    if (baseline.length >= 2) changes.push(change(card.price, median(baseline.map(p => p.price))));
  }
  const typical = median(changes), falling = changes.filter(n => n <= -0.04).length / changes.length;
  const covered = changes.length >= 20 && changes.length >= cards.length * 0.7;
  return {covered, sample: changes.length, medianChange: Number.isFinite(typical) ? typical : null,
    fallingShare: Number.isFinite(falling) ? falling : null,
    crash: covered && typical <= -0.04 && falling >= 0.6};
}

export function evaluate(card, now) {
  if (!eligible(card)) return {reason: 'outside_price_or_rating_filter'};
  if (now - card.at > 30 * 60_000) return {reason: 'stale'};
  if (now - card.lastAlert < DAY) return {reason: 'cooldown'};
  const recent = card.recent;
  if (recent.length < 3 || recent[2].at - recent[0].at < 20 * 60_000 ||
      recent.some(p => now - p.at > 60 * 60_000)) return {reason: 'needs_three_fresh_observations'};
  const h = hourly(card, now);
  // Three prior complete 24-hour windows, each with >=18 hourly observations.
  const days = [0, 1, 2].map(i => h.filter(p => p.at >= now - (i + 1) * DAY && p.at < now - i * DAY));
  if (days.some(d => d.length < 18)) return {reason: 'needs_three_days_history'};
  const medians = days.map(d => median(d.map(p => p.price)));
  if (medians[0] < medians[1] * 0.97 || medians[1] < medians[2] * 0.97)
    return {reason: 'declining_trend'};
  const prices = days.flat().map(p => p.price);
  const low = quantile(prices, 0.2), typical = median(prices);
  // Unusually large discontinuities need human review, not a bigger score.
  if (recent.some(p => p.price < low * 0.85) ||
      Math.max(...recent.map(p => p.price)) / Math.min(...recent.map(p => p.price)) > 1.04)
    return {reason: 'unstable_or_anomalous_price'};
  if (recent.some(p => p.price > low * 1.025) || card.price > typical * 0.94)
    return {reason: 'not_a_confirmed_dip'};
  // Conservative target: weakest daily upper quartile, then 2% undercut buffer.
  const target = Math.floor(Math.min(...days.map(d => quantile(d.map(p => p.price), 0.75))) * 0.98 / 100) * 100;
  const entry = Math.max(...recent.map(p => p.price));
  const net = Math.floor(target * 0.95) - entry;
  if (net < 1500 || net / entry < 0.05) return {reason: 'insufficient_margin'};
  // Count distinct dip -> recovery episodes, with >=2 later hourly readings at target.
  // A 12-hour search limit avoids counting an unrelated recovery days later.
  let episodes = 0, lastEnd = -Infinity;
  for (let i = 0; i < h.length; i++) {
    if (h[i].at <= lastEnd || h[i].price > low * 1.025) continue;
    const recovery = h.slice(i + 1).filter(p => p.at <= h[i].at + 12 * HOUR && p.price >= target);
    if (recovery.length >= 2) { episodes++; lastEnd = recovery[1].at; }
  }
  if (episodes < 3) return {reason: 'insufficient_repeated_recoveries'};
  return {reason: 'candidate', entry, target, net, margin: net / entry, episodes};
}

export function scan(state, rows, now = Date.now()) {
  const cards = ingest(state, rows, now);
  const market = marketCheck(cards, now);
  const coverage = state.ids.length >= 20 && cards.length >= state.ids.length * 0.8;
  if (market.crash) state.pauseUntil = now + 2 * HOUR;
  const paused = !coverage || !market.covered || now < state.pauseUntil;
  const outcomes = [];
  for (const call of state.calls.filter(c => c.status === 'open')) {
    const c = cards.find(c => c.id === call.id);
    // Do not claim a target if its confirming observations occurred after expiry.
    const targetSeen = c?.recent.filter(p => p.at > call.createdAt && p.at <= call.expiresAt && p.price >= call.target) ?? [];
    if (targetSeen.length >= 2 && targetSeen.at(-1).at - targetSeen[0].at >= 10 * 60_000) call.status = 'target_observed';
    else if (now >= call.expiresAt) call.status = 'expired';
    if (call.status !== 'open') outcomes.push({...call});
  }
  const reasons = {}, candidates = [];
  if (!paused) for (const card of cards) {
    const result = evaluate(card, now);
    reasons[result.reason] = (reasons[result.reason] ?? 0) + 1;
    if (result.reason === 'candidate') candidates.push({id: card.id, name: card.name, rating: card.rating,
      rarity: card.rarity, sourceAt: card.at, ...result});
  }
  const signals = candidates.sort((a, b) => b.episodes - a.episodes || b.margin - a.margin).slice(0, 5);
  for (const signal of signals) {
    state.cards[signal.id].lastAlert = now;
    state.calls.push({...signal, status: 'open', createdAt: now, expiresAt: now + 12 * HOUR});
  }
  state.calls = state.calls.filter(c => c.createdAt >= now - 7 * DAY);
  return {at: new Date(now).toISOString(), mode: 'private_bin_test', tracked: state.ids.length, fresh: cards.length,
    paused, pauseReason: !coverage ? 'insufficient_fresh_coverage' : !market.covered ? 'market_history_warming_up' :
      now < state.pauseUntil ? 'market_drop_cooldown' : null, market, reasons, signals, outcomes,
    disclaimer: 'BIN observations only; target observed does not mean a completed sale or realised profit.'};
}

export function snapshotSQL(platform) {
  const table = platform === 'ps5' ? 'public.futgg_bin_history' : platform === 'pc' ? 'public.futbot_pc_bin_history' : null;
  if (!table) throw new Error('PLATFORM must be ps5 or pc');
  return `SELECT p.source_card_id::text AS id, COALESCE(p.display_name,p.name,p.full_name) AS name,
    p.rating,p.rarity,l.lowest_bin AS price,l.captured_at AS at
    FROM public.futgg_players p JOIN LATERAL (
      SELECT h.lowest_bin,h.captured_at FROM ${table} h
      WHERE h.source_card_id=p.source_card_id AND h.game_year=$1 AND h.platform=$2
        AND h.lowest_bin>0 AND h.captured_at>=now()-interval '30 minutes' AND h.captured_at<=now()
      ORDER BY h.captured_at DESC,h.id DESC LIMIT 1
    ) l ON true WHERE p.game_year=$1 AND p.is_active=true
    AND ($3::text[] IS NULL OR p.source_card_id::text=ANY($3::text[]))
    AND ($3::text[] IS NOT NULL OR l.lowest_bin>20000 OR p.rating>85)
    ORDER BY md5(p.source_card_id::text) LIMIT $4`;
}

async function atomicJSON(file, data) {
  const temp = `${file}.tmp`;
  await writeFile(temp, JSON.stringify(data)); await rename(temp, file);
}
async function main() {
  const year = Number(process.env.GAME_YEAR ?? 27), platform = process.env.PLATFORM ?? 'ps5';
  const cap = Number(process.env.FLIP_TEST_MAX_CARDS ?? 300);
  if (!Number.isInteger(year) || year < 20 || !Number.isInteger(cap) || cap < 20 || cap > 1000)
    throw new Error('Use a valid GAME_YEAR and FLIP_TEST_MAX_CARDS from 20 to 1000');
  const sql = snapshotSQL(platform);
  const directory = resolve(process.env.FLIP_TEST_DIR ?? '.flip-test', `${year}-${platform}`);
  await mkdir(directory, {recursive: true});
  // One process per state directory; a crashed process can leave a lock. See docs.
  const lockPath = resolve(directory, 'scanner.lock');
  const lock = await open(lockPath, 'wx');
  let pool;
  try {
    await lock.writeFile(String(process.pid));
    const file = resolve(directory, 'state.json');
    let state;
    try {state = JSON.parse(await readFile(file, 'utf8'));}
    catch (error) {if (error.code !== 'ENOENT') throw error; state = emptyState(year, platform);}
    if (state.version !== 1 || state.year !== year || state.platform !== platform)
      throw new Error('State does not match scanner version/year/platform');
    if (!process.env.PRICE_DATABASE_URL) throw new Error('PRICE_DATABASE_URL is required');
    const {default: pg} = await import('pg');
    pool = new pg.Pool({connectionString: process.env.PRICE_DATABASE_URL, max: 1,
      statement_timeout: 8000, connectionTimeoutMillis: 10000, idleTimeoutMillis: 1000,
      options: '-c default_transaction_read_only=on', application_name: 'futbot-private-flip-test'});
    pool.on('error', () => console.error('Flip test: idle database connection error'));
    const tick = async () => {
      const now = Date.now();
      const discover = now - state.selectedAt >= DAY || !state.ids.length;
      const {rows} = await pool.query(sql, [year, platform, discover ? null : state.ids, cap]);
      if (discover && rows.length >= 20) {
        state.ids = rows.map(r => String(r.id)); state.selectedAt = now;
        const retained = new Set([...state.ids, ...state.calls.filter(c => c.status === 'open').map(c => c.id)]);
        for (const id of Object.keys(state.cards)) if (!retained.has(id)) delete state.cards[id];
      }
      const report = scan(state, rows, Date.now());
      // State includes signals/outcomes for seven days, avoiding an unbounded log.
      await atomicJSON(file, state);
      await atomicJSON(resolve(directory, 'latest.json'), report);
      console.log(JSON.stringify(report));
    };
    await tick();
    if (!process.argv.includes('--once')) {
      // Schedule after completion: slow queries cannot overlap. No tight retries.
      const controller = new AbortController();
      const stop = () => controller.abort();
      process.once('SIGINT', stop); process.once('SIGTERM', stop);
      while (!controller.signal.aborted) {
        try {await delay(900_000, undefined, {signal: controller.signal});}
        catch (error) {if (error.name === 'AbortError') break; throw error;}
        try {await tick();} catch {console.error('Flip test scan failed; no signals produced. Retrying in 15 minutes.');}
      }
      process.removeListener('SIGINT', stop); process.removeListener('SIGTERM', stop);
    }
  } finally {await pool?.end(); await lock.close(); await unlink(lockPath);}
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => {
    // Never print database exceptions/connection strings which may contain credentials.
    console.error(error.code === 'EEXIST' ? 'Flip test is locked. See scripts/flip-test.md.' :
      'Flip test failed. Check configuration, state directory, database access and documented indexes.');
    process.exitCode = 1;
  });
}
