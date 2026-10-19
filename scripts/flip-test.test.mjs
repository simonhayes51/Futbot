import test from 'node:test';
import assert from 'node:assert/strict';
import {eligible, emptyState, ingest, evaluate, marketCheck, scan, snapshotSQL} from './flip-test.mjs';

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
});
test('expired calls do not count targets first observed after expiry', () => {
  const state = emptyState(); state.calls = [{id: '1', status: 'open', createdAt: now - 13 * H, expiresAt: now - H, target: 100_000}];
  state.cards['1'] = card();
  state.cards['1'].recent = [31, 16, 1].map(m => ({at: now - m * 60_000, price: 110_000}));
  assert.equal(scan(state, [{id: '1', name: 'A', rating: 87, at: now - 60_000, price: 110_000}], now).outcomes[0].status, 'expired');
});
test('query only permits supported tables and parameterises filters', () => {
  assert.throws(() => snapshotSQL('anything_else'));
  assert.match(snapshotSQL('pc'), /public\.futbot_pc_bin_history/);
  assert.match(snapshotSQL('ps5'), /l\.lowest_bin>20000 OR p\.rating>85/);
});
test('snapshot SQL selects fresh eligible latest prices and limits subsequent reads to selected IDs', async () => {
  const {PGlite} = await import('@electric-sql/pglite');
  const db = new PGlite();
  try {
    await db.exec(`CREATE TABLE public.futgg_players(source_card_id bigint,game_year int,
      display_name text,name text,full_name text,rating int,rarity text,is_active boolean);
      CREATE TABLE public.futgg_bin_history(id serial,source_card_id bigint,game_year int,
      platform text,lowest_bin int,captured_at timestamptz);
      INSERT INTO futgg_players(source_card_id,game_year,name,rating,is_active) VALUES
      (1,27,'Boundary',85,true),(2,27,'Price',84,true),(3,27,'Rating',86,true),
      (4,27,'Inactive',90,false),(5,26,'Old year',90,true),(6,27,'Stale',90,true);
      INSERT INTO futgg_bin_history(source_card_id,game_year,platform,lowest_bin,captured_at) VALUES
      (1,27,'ps5',20000,now()),(2,27,'ps5',20001,now()),(3,27,'ps5',1000,now()),
      (4,27,'ps5',40000,now()),(5,26,'ps5',40000,now()),(6,27,'ps5',40000,now()-interval '2 hours'),
      (2,27,'ps5',999999,now()-interval '10 minutes'),(1,27,'pc',40000,now());`);
    const discovered = await db.query(snapshotSQL('ps5'), [27, 'ps5', null, 300]);
    assert.deepEqual(discovered.rows.map(r => r.id).sort(), ['2', '3']);
    assert.equal(Number(discovered.rows.find(r => r.id === '2').price), 20001);
    const tracked = await db.query(snapshotSQL('ps5'), [27, 'ps5', ['1', '2'], 300]);
    assert.deepEqual(tracked.rows.map(r => r.id).sort(), ['1', '2']);
  } finally {await db.close();}
});
