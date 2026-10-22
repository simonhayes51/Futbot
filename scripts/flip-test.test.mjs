import test from 'node:test';
import assert from 'node:assert/strict';
import {eligible, emptyState, ingest, evaluate, marketCheck, scan, snapshotSQL, historySQL, seedHistory, historyCoverage, diagnoseHistory, replayHistoricalPulls, enrichCardMetadata, formatReport} from './flip-test.mjs';

const H = 3_600_000, now = Date.UTC(2026, 9, 19, 12);
function card() {
  return {name: 'Example', rating: 87, rarity: 'Gold', at: now - 60_000, price: 92_000,
    lastAlert: 0, recent: [31, 16, 1].map(m => ({at: now - m * 60_000, price: 92_000})),
    history: Array.from({length: 96}, (_, i) => ({at: now - (96 - i) * H,
      values: [i % 12 < 3 ? 92_000 : 106_000]}))};
}
test('strict price OR rating filter, including boundary values', () => {
  assert.equal(eligible({price: 20_000, rating: 85}), false);
  assert.equal(eligible({price: 20_001, rating: 80}), true);
  assert.equal(eligible({price: 1000, rating: 86}), true);
});
test('repeated dips qualify, isolated peaks cannot raise target', () => {
  const c = card(), baseline = evaluate(c, now);
  assert.equal(baseline.reason, 'candidate');
  assert.ok(baseline.episodes >= 3);
  assert.equal(baseline.target, 103_800);
  c.history[50].values = [900_000];
  assert.equal(evaluate(c, now).target, baseline.target);
});
test('historical replay surfaces past qualifying entries separately from live calls', () => {
  const c = card(); c.id = 'historical-1';
  const replay = replayHistoricalPulls(c, now);
  assert.ok(replay.count > 0);
  assert.ok(replay.targetObserved > 0);
  assert.ok(replay.examples.every(s => s.entryBin < s.baselineBin && s.estimatedNetAfterTax > 0));
  assert.ok(replay.examples.some(s => s.outcome === 'target_observed'));
  assert.ok(replay.examples.every(s => s.horizons['12h']));
  const recentOnly = {...c, history: c.history.filter(p => p.at >= now - 12 * H)};
  assert.equal(replayHistoricalPulls(recentOnly, now).count, 0);
});
test('historical replay distinguishes late recovery from a failed 12-hour setup', () => {
  const c = {id: 'late-recovery', name: 'Late Card', rating: 87, rarity: 'Special', history: []};
  c.history = Array.from({length: 120}, (_, i) => ({at: now - (120 - i) * H,
    values: [i >= 30 && i < 45 ? 80_000 : 100_000]}));
  const setup = replayHistoricalPulls(c, now).examples.find(s => s.entryBin === 80_000);
  assert.ok(setup);
  assert.equal(setup.horizons['12h'].status, 'not_observed');
  assert.equal(setup.horizons['24h'].status, 'target_observed');
  assert.equal(setup.horizons['48h'].status, 'target_observed');
  assert.equal(setup.outcome, 'target_not_observed_within_12h');
});
test('human report formats historical trades and keeps live calls clearly separate', () => {
  const output = formatReport({at: '2026-10-22T18:07:24.774Z', year: 27, platform: 'ps5',
    fresh: 300, tracked: 300, historyCoverage: {usableCards: 291}, paused: false,
    market: {covered: true, medianChange: -0.0031, fallingShare: 0.14}, signals: [], reasons: {},
    historicalPulls: {setups: 106, targetObserved: 29,
      horizons: {'12h': {resolved: 106, targetObserved: 29, hitRate: 29 / 106},
        '24h': {resolved: 80, targetObserved: 40, hitRate: 0.5}, '48h': {resolved: 50, targetObserved: 45, hitRate: 0.9}},
      byDipDepth: {'15–25% dip': {horizons: {'24h': {resolved: 40, targetObserved: 30, hitRate: 0.75}}}},
      learning: {resolved12h: 106, sampleForCalibration: 50, status: 'review_threshold_met'},
      successfulExamples: [{id: '67338422', name: 'Dayot Upamecano',
      rating: 89, rarity: 'Destined for Glory · Pristine Holographic', entryAt: '2026-10-22T00:00:00.000Z',
      entryBin: 2400000, targetBin: 2744000, estimatedNetAfterTax: 206800, estimatedMargin: 0.086,
      outcome: 'target_observed', targetObservedAt: '2026-10-22T09:00:00.000Z'}],
      missedExamples: [{id: 'miss-1', name: 'Missed Example', rating: 87, rarity: 'Rare',
        entryAt: '2026-10-21T00:00:00.000Z', entryBin: 50_000, targetBin: 60_000,
        estimatedNetAfterTax: 7_000, estimatedMargin: 0.14, outcome: 'target_not_observed_within_12h',
        horizons: {'24h': {status: 'not_observed'}, '48h': {status: 'not_observed'}}}]}});
  assert.match(output, /Historical setups: 106 · target observed 29/);
  assert.match(output, /Recovery by horizon: 12h 29\/106/);
  assert.match(output, /By dip depth: 15–25% dip: 30\/40 24h/);
  assert.match(output, /Learning sample: 106\/50 resolved setups/);
  assert.match(output, /Dayot Upamecano \(89 · Destined for Glory · Pristine Holographic\)/);
  assert.match(output, /buy 2,400,000 coins → target 2,744,000 coins/);
  assert.match(output, /TARGET OBSERVED by 12h at 09:00 UTC/);
  assert.match(output, /Successful historical setups:/);
  assert.match(output, /Missed historical setups:/);
  assert.match(output, /Missed Example.*not observed by 48h/);
  assert.match(output, /Live buy calls: 0/);
  assert.doesNotMatch(output, /LIVE BUY CALL/);
});
test('rejects falling trends, thin history, unstable prices and stale confirmations', () => {
  const c = card();
  for (const p of c.history) if (p.at < now - 48 * H) p.values = p.values.map(v => v * 1.2);
  assert.equal(evaluate(c, now).reason, 'declining_trend');
  assert.equal(evaluate({...card(), history: []}, now).reason, 'needs_three_days_history');
  const bad = card(); bad.recent[0].price = 105_000;
  assert.equal(evaluate(bad, now).reason, 'unstable_or_anomalous_price');
  const stale = card(); stale.recent[0].at = now - 2 * H;
  assert.equal(evaluate(stale, now).reason, 'needs_three_fresh_observations');
});
test('same captured_at cannot produce extra confirmations; stale/future rows discarded', () => {
  const state = emptyState(), row = {id: '1', name: 'A', rating: 87, price: 92_000, at: now - 60_000};
  for (let i = 0; i < 4; i++) ingest(state, [row], now);
  assert.equal(state.cards['1'].recent.length, 1);
  assert.equal(ingest(state, [{...row, price: 10_000}], now).length, 0);
  assert.equal(ingest(state, [{...row, at: now - 120_000}], now).length, 0);
  assert.equal(ingest(state, [{...row, id: '2', at: now - H}, {...row, id: '3', at: now + 1}], now).length, 0);
});
test('broad declines trigger pause, isolated decline does not; sparse basket fails closed', () => {
  const stable = Array.from({length: 30}, (_, i) => ({...card(), id: String(i), price: 106_000,
    history: [1, 2].map(n => ({at: now - n * H, values: [106_000]}))}));
  stable[0].price = 60_000;
  assert.equal(marketCheck(stable, now).crash, false);
  stable.forEach(c => c.price = 95_000);
  assert.equal(marketCheck(stable, now).crash, true);
  const state = emptyState(); state.ids = stable.map(c => c.id);
  state.cards = Object.fromEntries(stable.map(c => [c.id, c]));
  const rows = stable.map(c => ({...c, at: now}));
  assert.equal(scan(state, rows, now).paused, true);
  assert.equal(state.pauseUntil, now + 2 * H);
  assert.equal(scan(emptyState(), [], now).paused, true);
});
test('candidate log is capped, deduplicated and outcomes require sustained later observations', () => {
  const state = emptyState(); state.ids = Array.from({length: 30}, (_, i) => String(i));
  state.cards = Object.fromEntries(state.ids.map(id => {
    const c = card();
    if (Number(id) >= 10) {c.price = 106_000; c.recent.forEach(p => p.price = 106_000);}
    return [id, c];
  }));
  const rows = state.ids.map(id => ({id, name: 'Example', rating: 87, price: Number(id) < 10 ? 92_000 : 106_000, at: now - 60_000}));
  const report = scan(state, rows, now);
  assert.equal(report.paused, false); assert.equal(report.signals.length, 5);
  const id = report.signals[0].id;
  assert.equal(evaluate(state.cards[id], now).reason, 'cooldown');
  const call = state.calls[0];
  state.cards[id].recent = [1, 16, 31].map(m => ({at: now + m * 60_000, price: call.target}));
  const outcome = scan(state, rows.map(r => r.id === id ? {...r, at: now + 31 * 60_000, price: call.target} : r), now + 32 * 60_000);
  assert.ok(outcome.outcomes.some(c => c.id === id && c.status === 'target_observed'));
  assert.ok(outcome.historicalPulls);
  assert.match(outcome.historicalPulls.disclaimer, /Retrospective BIN replay only/);
});
test('expired calls do not count targets first observed after expiry', () => {
  const state = emptyState(); state.calls = [{id: '1', status: 'open', createdAt: now - 13 * H, expiresAt: now - H, target: 100_000}];
  state.cards['1'] = card();
  state.cards['1'].recent = [31, 16, 1].map(m => ({at: now - m * 60_000, price: 110_000}));
  assert.equal(scan(state, [{id: '1', name: 'A', rating: 87, at: now - 60_000, price: 110_000}], now).outcomes[0].status, 'expired');
});
test('query only permits supported tables and parameterises filters', () => {
  assert.throws(() => snapshotSQL('anything_else'));
  assert.throws(() => historySQL('anything_else'));
  assert.throws(() => historySQL('ps5', 169));
  assert.throws(() => historySQL('ps5', '4;DROP TABLE'));
  assert.match(snapshotSQL('pc'), /public\.futbot_pc_bin_history/);
  assert.match(snapshotSQL('ps5'), /l\.lowest_bin>20000 OR p\.rating>85/);
  assert.match(snapshotSQL('ps5'), /s\.source_player_id=p\.source_player_id/);
});
test('holographic metadata uses exact verified item first and base player fallback', () => {
  const gallery = [{id: '67338422', year: 27, name: 'Dayot Upamecano', rating: 89,
    rarity: 'Destined for Glory', finish: 'pristine'}];
  const [known, sibling, placeholder] = enrichCardMetadata([
    {id: '67338422', year: 27, name: null, base_name: 'Upamecano', rating: 0, rarity: null},
    {id: '999', year: 27, name: null, base_name: 'Lothar Matthäus', rating: 0, rarity: null},
    {id: '1000', year: 27, name: 'Unknown', base_name: null, rating: 0, rarity: null}
  ], gallery);
  assert.deepEqual([known.name, known.rating, known.rarity],
    ['Dayot Upamecano', 89, 'Destined for Glory · Pristine Holographic']);
  assert.deepEqual([sibling.name, sibling.rating], ['Lothar Matthäus', null]);
  assert.deepEqual([placeholder.name, placeholder.rating], [null, null]);
});
test('snapshot SQL selects fresh eligible latest prices and limits subsequent reads to selected IDs', async () => {
  const {PGlite} = await import('@electric-sql/pglite');
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE public.futgg_players(source_card_id bigint,source_player_id bigint,game_year int,
      display_name text,name text,full_name text,rating int,rarity text,is_active boolean);
      CREATE TABLE public.futgg_bin_history(id serial,source_card_id bigint,game_year int,
      platform text,lowest_bin int,captured_at timestamptz);
      INSERT INTO futgg_players(source_card_id,game_year,name,rating,is_active) VALUES
      (1,27,'Boundary',85,true),(2,27,'Price',84,true),(3,27,'Rating',86,true),
      (4,27,'Inactive',90,false),(5,26,'Old year',90,true),(6,27,'Stale',90,true);
      UPDATE futgg_players SET source_player_id=source_card_id;
      INSERT INTO futgg_players(source_card_id,source_player_id,game_year,name,rating,is_active) VALUES
      (7,7,27,'Lothar Matthäus',90,true),(167773,7,27,'Unknown',0,true);
      INSERT INTO futgg_bin_history(source_card_id,game_year,platform,lowest_bin,captured_at) VALUES
      (1,27,'ps5',20000,now()),(2,27,'ps5',20001,now()),(3,27,'ps5',1000,now()),
      (4,27,'ps5',40000,now()),(5,26,'ps5',40000,now()),(6,27,'ps5',40000,now()-interval '2 hours'),
      (167773,27,'ps5',30000,now()),
      (2,27,'ps5',999999,now()-interval '61 minutes'),(1,27,'pc',40000,now());`);
    const discovered = await db.query(snapshotSQL('ps5'), [27, 'ps5', null, 300]);
    assert.deepEqual(discovered.rows.map(r => r.id).sort(), ['167773', '2', '3']);
    assert.equal(Number(discovered.rows.find(r => r.id === '2').price), 20001);
    const tracked = await db.query(snapshotSQL('ps5'), [27, 'ps5', ['1', '2'], 300]);
    assert.deepEqual(tracked.rows.map(r => r.id).sort(), ['1', '2']);
    const holo = await db.query(snapshotSQL('ps5'), [27, 'ps5', ['167773'], 300]);
    assert.equal(holo.rows[0].base_name, 'Lothar Matthäus');
    await db.exec(`INSERT INTO futgg_bin_history(source_card_id,game_year,platform,lowest_bin,captured_at) VALUES
      (2,27,'ps5',21000,now()-interval '16 minutes'),(2,27,'ps5',22000,now()-interval '31 minutes'),
      (2,27,'ps5',23000,now()-interval '46 minutes'),(2,27,'ps5',100,now()+interval '1 hour'),
      (2,27,'ps5',100,now()-interval '8 days'),(2,26,'ps5',100,now()-interval '2 hours'),
      (2,27,'pc',100,now()-interval '2 hours'),(2,27,'ps5',40000,now()-interval '2 hours'),
      (2,27,'ps5',40000,now()-interval '2 hours'),
      (2,27,'ps5',60000,now()-interval '3 days');`);
    const asOf = new Date();
    const seeded = await db.query(historySQL('ps5'), [27, 'ps5', ['2'], asOf]);
    assert.ok(seeded.rows.every(r => r.id === '2'));
    const recent = seeded.rows.filter(r => r.kind === 'recent');
    assert.equal(recent.length, 3);
    assert.deepEqual(recent.map(r => Number(r.price)), [20001, 21000, 22000]);
    assert.ok(seeded.rows.some(r => r.kind === 'hour' && Number(r.price) === 40000));
    assert.ok(seeded.rows.some(r => r.kind === 'hour' && Number(r.price) === 60000));
    const catchup = await db.query(historySQL('ps5', 4), [27, 'ps5', ['2'], asOf]);
    assert.ok(catchup.rows.some(r => r.kind === 'hour' && Number(r.price) === 40000));
    assert.ok(!catchup.rows.some(r => r.kind === 'hour' && Number(r.price) === 60000));
    assert.equal((await db.query(historySQL('ps5'), [27, 'ps5', [], asOf])).rows.length, 0);
  } finally {await db.close();}
});
test('existing history enables first-run signals without waiting or resetting cooldowns', () => {
  const state = emptyState(); state.ids = Array.from({length: 30}, (_, i) => String(i));
  const history = state.ids.flatMap(id => {
    const c = card();
    return [...c.history.map(p => ({id, kind: 'hour', at: p.at, price: p.values[0]})),
      ...c.recent.map(p => ({id, kind: 'recent', at: p.at, price: Number(id) < 10 ? p.price : 106_000}))];
  });
  seedHistory(state, state.ids, history, now);
  const rows = state.ids.map(id => ({id, name: 'Example', rating: 87, price: Number(id) < 10 ? 92_000 : 106_000, at: now - 60_000}));
  const report = scan(state, rows, now);
  assert.equal(report.paused, false);
  assert.equal(report.signals.length, 5);
  const call = state.calls[0], lastAlert = state.cards[call.id].lastAlert;
  seedHistory(state, state.ids, history, now);
  assert.equal(state.cards[call.id].lastAlert, lastAlert);
  assert.equal(state.cards[call.id].history.length, 96);
  assert.equal(state.cards[call.id].recent.length, 3);
  assert.equal(state.calls[0], call);
});
test('seeded data cannot invent missing history or accept future/invalid rows', () => {
  const state = emptyState();
  seedHistory(state, ['1'], [{id: '1', kind: 'hour', at: now + H, price: 100},
    {id: '1', kind: 'recent', at: now - 60_000, price: -100},
    {id: '1', kind: 'hour', at: now - 8 * 24 * H, price: 100}], now);
  assert.equal(state.cards['1'].history.length, 0);
  assert.equal(state.cards['1'].recent.length, 0);
  assert.ok(state.cards['1'].historySeededAt);
  const c = {...state.cards['1'], name: 'A', rating: 87, price: 92_000, at: now,
    recent: card().recent};
  assert.equal(evaluate(c, now).reason, 'needs_three_days_history');
});
test('observed 22/12/23-hour feed coverage is usable; thin and multiple partial days fail', () => {
  const c = card();
  function keepHours(counts) {
    return {...c, history: counts.flatMap((n, i) => c.history.filter(p =>
      p.at >= now - (i + 1) * 24 * H && p.at < now - i * 24 * H).slice(-n)).sort((a, b) => a.at - b.at)};
  }
  const partial = keepHours([22, 12, 23]);
  assert.deepEqual(historyCoverage(partial, now).hours, [22, 12, 23]);
  assert.equal(historyCoverage(partial, now).usable, true);
  const result = evaluate(partial, now);
  assert.equal(result.reason, 'candidate');
  assert.equal(result.historyQuality, 'one_partial_day');
  assert.equal(result.totalObservedHours, 57);
  for (const counts of [[22, 11, 23], [17, 17, 23], [18, 12, 18], [4, 12, 23]]) {
    assert.equal(historyCoverage(keepHours(counts), now).usable, false);
    assert.equal(evaluate(keepHours(counts), now).reason, 'needs_three_days_history');
  }
});
test('unobserved gaps cannot be counted as repeated recovery episodes', () => {
  const c = card();
  // Three hours of low observations followed by a five-hour gap before highs.
  // Coverage still passes, but none of these isolated lows proves a recovery.
  c.history = [];
  for (let d = 0; d < 4; d++) for (let hour = 0; hour < 24; hour++) {
    if (hour >= 3 && hour < 7) continue;
    c.history.push({at: now - (4 - d) * 24 * H + hour * H, values: [hour < 3 ? 92_000 : 106_000]});
  }
  assert.equal(historyCoverage(c, now).usable, true);
  assert.equal(evaluate(c, now).reason, 'insufficient_repeated_recoveries');
});
test('seeded current-hour prices become a market baseline after a manual-run break', () => {
  const state = emptyState(); state.ids = Array.from({length: 30}, (_, i) => String(i));
  const first = now + 46 * 60_000, later = first + 40 * 60_000;
  const points = state.ids.flatMap(id => [
    {id, kind: 'hour', at: now - H, price: 106_000},
    ...[31, 16, 1].map(m => ({id, kind: 'recent', at: first - m * 60_000, price: 106_000}))
  ]);
  seedHistory(state, state.ids, points, first);
  assert.ok(state.cards['0'].history.some(p => p.at === now));
  scan(state, state.ids.map(id => ({id, name: 'A', rating: 87, price: 106_000, at: first - 60_000})), first);
  const report = scan(state, state.ids.map(id => ({id, name: 'A', rating: 87, price: 106_000, at: later - 60_000})), later);
  assert.equal(report.market.sample, 30);
  assert.equal(report.paused, false);
});

test('history diagnostic explains strict and exploratory coverage without signals', () => {
  const state = emptyState(); state.ids = ['thin', 'complete'];
  function historyCard(id, counts) {
    const c = card();
    c.id = id;
    c.recent = [];
    c.history = counts.flatMap((count, day) => Array.from({length: count}, (_, i) => ({
      at: now - (day + 1) * 24 * H + i * H, values: [100_000]
    })));
    return c;
  }
  state.cards = {thin: historyCard('thin', [17, 24, 11]), complete: historyCard('complete', [22, 24, 24])};
  const rows = state.ids.map(id => ({id, name: id, rating: 87, price: 100_000, at: now - 59_000}));
  const report = diagnoseHistory(state, rows, now);
  assert.equal(report.mode, 'history_diagnostic_only');
  assert.equal(report.summary.strictHistoryPass, 1);
  assert.equal(report.summary.exploratoryCoveragePass, 2);
  assert.deepEqual(report.cards.find(c => c.id === 'thin').strictHistoryFailures,
    ['day_3_below_12_hours', 'total_below_54_hours']);
  assert.equal(report.cards.find(c => c.id === 'thin').exploratoryCoveragePass, true);
  assert.equal('signals' in report, false);
  assert.equal(state.calls.length, 0);
});
