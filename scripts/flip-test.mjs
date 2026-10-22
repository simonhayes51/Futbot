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

export function historyCoverage(card, now) {
  const h = hourly(card, now);
  const days = [0, 1, 2].map(i => h.filter(p => p.at >= now - (i + 1) * DAY && p.at < now - i * DAY));
  const hours = days.map(d => d.length), total = hours.reduce((a, b) => a + b, 0);
  const partialDays = hours.filter(n => n < 18).length;
  return {h, days, hours, total, partialDays,
    usable: hours.every(n => n >= 12) && partialDays <= 1 && total >= 54};
}

// Seed only selected cards, using bounded batches of hourly aggregates. This also
// upgrades existing test state; a per-card marker prevents repeated backfills.
export function seedHistory(state, ids, rows, now) {
  for (const id of ids) {
    const card = state.cards[id] ??= {history: [], recent: [], lastAlert: 0};
    const hours = new Map(card.history.map(p => [p.at, p]));
    const recent = new Map(card.recent.map(p => [p.at, p]));
    for (const row of rows.filter(r => String(r.id) === id)) {
      const at = new Date(row.at).getTime(), price = Number(row.price);
      if (!Number.isFinite(at) || !Number.isFinite(price) || price <= 0 || at > now) continue;
      if (row.kind === 'hour' && at < Math.floor(now / HOUR) * HOUR && at >= now - 7 * DAY)
        hours.set(at, {at, values: [price]});
      if (row.kind === 'recent' && at >= now - HOUR) recent.set(at, {at, price});
    }
    card.recent = [...recent.values()].filter(p => p.at >= now - HOUR).sort((a, b) => a.at - b.at).slice(-3);
    // These timestamps are already in recent, so ingest will not add them again.
    // Record their current-hour samples here or the first completed hour is lost.
    for (const p of card.recent) {
      const bucket = Math.floor(p.at / HOUR) * HOUR;
      if (bucket !== Math.floor(now / HOUR) * HOUR) continue;
      const point = hours.get(bucket) ?? {at: bucket, values: []};
      point.values[Math.floor(p.at / 900_000) % 4] = p.price;
      hours.set(bucket, point);
    }
    card.history = [...hours.values()].filter(p => p.at >= now - 7 * DAY).sort((a, b) => a.at - b.at);
    card.historySeededAt = now;
  }
}

function historyTable(platform) {
  if (platform === 'ps5') return 'public.futgg_bin_history';
  if (platform === 'pc') return 'public.futbot_pc_bin_history';
  throw new Error('PLATFORM must be ps5 or pc');
}

export function historySQL(platform, hours = 168) {
  if (!Number.isInteger(hours) || hours < 1 || hours > 168) throw new Error('History hours must be 1–168');
  const table = historyTable(platform);
  return `SELECT p.source_card_id::text AS id,'hour' AS kind,h.at,h.price
    FROM public.futgg_players p JOIN LATERAL (
      SELECT date_trunc('hour',captured_at) AS at,
        percentile_cont(0.5) WITHIN GROUP(ORDER BY lowest_bin) AS price
      FROM ${table} WHERE source_card_id=p.source_card_id AND game_year=$1 AND platform=$2
        AND lowest_bin>0 AND captured_at>=date_trunc('hour',$4::timestamptz)-interval '${hours} hours'
        AND captured_at<date_trunc('hour',$4::timestamptz)
      GROUP BY 1
    ) h ON true WHERE p.game_year=$1 AND p.source_card_id::text=ANY($3::text[])
    UNION ALL
    SELECT p.source_card_id::text AS id,'recent' AS kind,h.captured_at AS at,h.lowest_bin AS price
    FROM public.futgg_players p JOIN LATERAL (
      SELECT captured_at,lowest_bin FROM (
        SELECT DISTINCT ON (date_bin(interval '15 minutes',captured_at,timestamptz '2000-01-01'))
          captured_at,lowest_bin,id
        FROM ${table} WHERE source_card_id=p.source_card_id AND game_year=$1 AND platform=$2
          AND lowest_bin>0 AND captured_at >= $4::timestamptz-interval '1 hour'
          AND captured_at <= $4::timestamptz
        ORDER BY date_bin(interval '15 minutes',captured_at,timestamptz '2000-01-01') DESC,captured_at DESC,id DESC
      ) slots ORDER BY captured_at DESC,id DESC LIMIT 3
    ) h ON true WHERE p.game_year=$1 AND p.source_card_id::text=ANY($3::text[])`;
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
  // Allow one partially observed day, while requiring 75% overall coverage.
  const {h, days, hours, total, partialDays, usable} = historyCoverage(card, now);
  if (!usable) return {reason: 'needs_three_days_history'};
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
  const dipCeiling = Math.min(low * 1.025, typical * 0.94, entry * 1.025);
  for (let i = 0; i < h.length; i++) {
    if (h[i].at <= lastEnd || h[i].price > dipCeiling) continue;
    // A gap cannot establish what happened in between: end this episode at a gap.
    const observed = [];
    let previousAt = h[i].at;
    for (const p of h.slice(i + 1)) {
      if (p.at > h[i].at + 12 * HOUR || p.at - previousAt > 3 * HOUR) break;
      observed.push(p); previousAt = p.at;
    }
    const recovery = observed.filter(p => p.price >= target);
    if (recovery.length >= 2) { episodes++; lastEnd = recovery[1].at; }
  }
  if (episodes < 3) return {reason: 'insufficient_repeated_recoveries'};
  return {reason: 'candidate', entry, target, net, margin: net / entry, episodes,
    historyQuality: partialDays ? 'one_partial_day' : 'complete', observedHours: hours, totalObservedHours: total};
}

// Retrospective check: look for earlier BIN entries that had enough room to
// clear EA tax, then record whether the target was later observed. This is
// deliberately reported separately from live signals; it uses future history
// to score a past entry and must never be presented as a current buy call.
export function replayHistoricalPulls(card, now, limit = 5) {
  const h = hourly(card, now).filter(p => p.at >= now - 7 * DAY && Number.isFinite(p.price) && p.price > 0);
  const setups = [];
  const lastObservedAt = h.at(-1)?.at ?? 0;
  let blockedUntil = -Infinity;
  for (let i = 12; i < h.length - 1; i++) {
    const dip = h[i];
    // Do not grade an incomplete 12-hour outcome window as a failed setup.
    if (dip.at + 12 * HOUR > lastObservedAt) continue;
    if (dip.at <= blockedUntil) continue;
    const baselineRows = h.filter(p => p.at >= dip.at - DAY && p.at < dip.at);
    if (baselineRows.length < 12) continue;
    const baseline = median(baselineRows.map(p => p.price));
    const target = Math.floor(baseline * 0.98 / 100) * 100;
    const entry = dip.price;
    const net = Math.floor(target * 0.95) - entry;
    if (entry > baseline * 0.90 || net < 1500 || net / entry < 0.05) continue;

    const future = h.slice(i + 1).filter(p => p.at <= dip.at + 12 * HOUR);
    const recovery = future.filter(p => p.price >= target);
    const reached = recovery.length >= 2 && recovery[1].at - recovery[0].at >= HOUR;
    const recoveredAt = reached ? recovery[1].at : null;
    setups.push({id: String(card.id ?? ''), name: card.name ?? null,
      rating: Number.isFinite(card.rating) ? card.rating : null, entryAt: new Date(dip.at).toISOString(),
      entryBin: entry, baselineBin: Math.round(baseline), targetBin: target,
      estimatedNetAfterTax: net, estimatedMargin: net / entry,
      outcome: reached ? 'target_observed' : 'target_not_observed_within_12h',
      targetObservedAt: recoveredAt === null ? null : new Date(recoveredAt).toISOString()});
    // Treat one fall and its recovery (or 12-hour observation window) as one setup.
    blockedUntil = recoveredAt ?? dip.at + 12 * HOUR;
  }
  const ranked = setups.sort((a, b) => Number(b.outcome === 'target_observed') - Number(a.outcome === 'target_observed') ||
    b.estimatedNetAfterTax - a.estimatedNetAfterTax);
  return {count: setups.length, targetObserved: setups.filter(s => s.outcome === 'target_observed').length,
    examples: ranked.slice(0, limit)};
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
  for (const card of cards) {
    const result = evaluate(card, now);
    reasons[result.reason] = (reasons[result.reason] ?? 0) + 1;
    if (!paused && result.reason === 'candidate') candidates.push({id: card.id, name: card.name, rating: card.rating,
      rarity: card.rarity, sourceAt: card.at, ...result});
  }
  const signals = candidates.sort((a, b) => Number(a.historyQuality === 'one_partial_day') - Number(b.historyQuality === 'one_partial_day') ||
    b.episodes - a.episodes || b.margin - a.margin).slice(0, 5);
  for (const signal of signals) {
    state.cards[signal.id].lastAlert = now;
    state.calls.push({...signal, status: 'open', createdAt: now, expiresAt: now + 12 * HOUR});
  }
  state.calls = state.calls.filter(c => c.createdAt >= now - 7 * DAY);
  const coverageChecks = cards.map(c => historyCoverage(c, now));
  const historicalPulls = cards.map(c => replayHistoricalPulls(c, now, 2));
  const historicalExamples = historicalPulls.flatMap(c => c.examples)
    .sort((a, b) => Number(b.outcome === 'target_observed') - Number(a.outcome === 'target_observed') ||
      b.estimatedNetAfterTax - a.estimatedNetAfterTax).slice(0, 10);
  return {at: new Date(now).toISOString(), mode: 'private_bin_test', tracked: state.ids.length, fresh: cards.length,
    historyCoverage: {usableCards: coverageChecks.filter(c => c.usable).length,
      usableWithPartialDay: coverageChecks.filter(c => c.usable && c.partialDays === 1).length,
      medianHoursByDay: [0, 1, 2].map(i => median(coverageChecks.map(c => c.hours[i])))},
    paused, pauseReason: !coverage ? 'insufficient_fresh_coverage' : !market.covered ? 'market_history_warming_up' :
      now < state.pauseUntil ? 'market_drop_cooldown' : null, market, reasons, signals, outcomes,
    historicalPulls: {setups: historicalPulls.reduce((n, c) => n + c.count, 0),
      targetObserved: historicalPulls.reduce((n, c) => n + c.targetObserved, 0), examples: historicalExamples,
      disclaimer: 'Retrospective BIN replay only. These are past setups scored using later observations, not live buy calls or completed sales.'},
    disclaimer: 'BIN observations only; target observed does not mean a completed sale or realised profit.'};
}


export function diagnoseHistory(state, rows, now = Date.now()) {
  const cards = ingest(state, rows, now);
  const details = cards.map(card => {
    const coverage = historyCoverage(card, now);
    const failures = [];
    coverage.hours.forEach((count, index) => {
      if (count < 12) failures.push(`day_${index + 1}_below_12_hours`);
    });
    if (coverage.partialDays > 1) failures.push('more_than_one_partial_day');
    if (coverage.total < 54) failures.push('total_below_54_hours');
    const recent = card.recent ?? [];
    const freshConfirmed = recent.length >= 3 && recent[2].at - recent[0].at >= 20 * 60_000 &&
      recent.every(point => now - point.at <= 60 * 60_000);
    const exploratoryPass = coverage.hours.every(count => count >= 10) &&
      coverage.partialDays <= 2 && coverage.total >= 50;
    return {id: card.id, name: card.name, rating: card.rating, fresh: now - card.at <= 30 * 60_000,
      observedHoursByDay: coverage.hours, totalObservedHours: coverage.total,
      partialDays: coverage.partialDays, strictHistoryPass: coverage.usable,
      strictHistoryFailures: failures, exploratoryCoveragePass: exploratoryPass,
      recentObservations: recent.length,
      recentSpanMinutes: recent.length >= 2 ? Math.round((recent.at(-1).at - recent[0].at) / 60_000) : 0,
      freshConfirmationPass: freshConfirmed};
  });
  const failureCounts = {};
  for (const card of details) for (const failure of card.strictHistoryFailures)
    failureCounts[failure] = (failureCounts[failure] ?? 0) + 1;
  return {at: new Date(now).toISOString(), mode: 'history_diagnostic_only',
    tracked: state.ids.length, fresh: cards.length,
    summary: {strictHistoryPass: details.filter(c => c.strictHistoryPass).length,
      exploratoryCoveragePass: details.filter(c => c.exploratoryCoveragePass).length,
      freshConfirmationPass: details.filter(c => c.freshConfirmationPass).length,
      strictFailureCounts: failureCounts},
    cards: details,
    disclaimer: 'Coverage diagnostics only. Exploratory thresholds are hypothetical and are not used to evaluate candidates or create signals.'};
}

export function snapshotSQL(platform) {
  const table = historyTable(platform);
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
      let {rows} = await pool.query(sql, [year, platform, discover ? null : state.ids, cap]);
      if (discover && rows.length >= 20) {
        state.ids = rows.map(r => String(r.id)); state.selectedAt = now;
        const retained = new Set([...state.ids, ...state.calls.filter(c => c.status === 'open').map(c => c.id)]);
        for (const id of Object.keys(state.cards)) if (!retained.has(id)) delete state.cards[id];
      }
      const unseeded = rows.map(r => String(r.id)).filter(id => {
        const card = state.cards[id];
        return !card?.historySeededAt || (card.history.at(-1)?.at ?? card.historySeededAt) < now - DAY;
      });
      let historyRows = 0;
      for (let i = 0; i < unseeded.length; i += 20) {
        const ids = unseeded.slice(i, i + 20);
        const loaded = await pool.query(historySQL(platform), [year, platform, ids, new Date(now)]);
        seedHistory(state, ids, loaded.rows, now);
        historyRows += loaded.rows.length;
        console.error(`Flip test history loaded: ${Math.min(i + 20, unseeded.length)}/${unseeded.length} cards`);
      }
      // A manual --once run may follow a long break. Fill only the missed recent
      // window instead of leaving the market baseline empty or reloading a week.
      const fullLoads = new Set(unseeded);
      const catchup = !state.lastScanAt || now - state.lastScanAt > 25 * 60_000
        ? rows.map(r => String(r.id)).filter(id => !fullLoads.has(id)) : [];
      const catchupHours = Math.min(168, Math.max(4, Math.ceil((now - (state.lastScanAt ?? now - 3 * HOUR)) / HOUR) + 1));
      let refreshedRows = 0;
      for (let i = 0; i < catchup.length; i += 20) {
        const ids = catchup.slice(i, i + 20);
        const loaded = await pool.query(historySQL(platform, catchupHours), [year, platform, ids, new Date(now)]);
        seedHistory(state, ids, loaded.rows, now);
        refreshedRows += loaded.rows.length;
        console.error(`Flip test recent history refreshed: ${Math.min(i + 20, catchup.length)}/${catchup.length} cards`);
      }
      // Backfill can take time: use a fresh snapshot for the first decision.
      if (unseeded.length || catchup.length) ({rows} = await pool.query(sql, [year, platform, state.ids.length ? state.ids : rows.map(r => String(r.id)), cap]));
      const report = process.argv.includes('--diagnose-history')
        ? diagnoseHistory(state, rows, Date.now()) : scan(state, rows, Date.now());
      report.historyLoaded = {cards: unseeded.length, rows: historyRows};
      report.historyRefreshed = {cards: catchup.length, rows: refreshedRows, hours: catchup.length ? catchupHours : 0};
      state.lastScanAt = Date.now();
      // State includes signals/outcomes for seven days, avoiding an unbounded log.
      await atomicJSON(file, state);
      await atomicJSON(resolve(directory, 'latest.json'), report);
      console.log(`Flip test report: ${JSON.stringify(report)}`);
    };
    await tick();
    if (!process.argv.includes('--once') && !process.argv.includes('--diagnose-history')) {
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
