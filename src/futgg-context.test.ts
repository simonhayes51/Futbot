import test from 'node:test';
import assert from 'node:assert/strict';
import {fetchFutggContext, normaliseEvolutions, normaliseGallery} from './futgg-context.js';

test('Evolution watch includes open cards and separates trending from confirmed eligibility', () => {
  const now = Date.parse('2026-10-19T12:00:00Z');
  const rows = normaliseEvolutions([{id: 1, game: 27, name: 'Open Evo', endSubmissionTime: '2026-10-20T12:00:00Z',
    eligiblePlayerItemIds: [123, '124', 'bad'], trendingPlayersIds: ['123_2596', '125_2596'], coinsCost: 5000},
  {id: 2, name: 'Expired', endTime: '2026-10-18T12:00:00Z'}, {id: 3, name: 'Unknown'}], now);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0].eligibleCardIds, ['123', '124']);
  assert.deepEqual(rows[0].trendingCardIds, ['125']);
  assert.equal(rows[0].coinsCost, 5000);
});

test('Gallery ranks positive coin-per-token tiers and keeps zero cost unranked', () => {
  const rows = normaliseGallery({data: {
    categories: [{sets: [{id: 8, name: 'Weekend Cup'}]}],
    sets: [{setId: 8, costTiers: [
      {grade: 'A', cost: 12000, tokens: 20, items: [{eaId: 1}]},
      {grade: 'B', cost: 0, tokens: 50, items: []},
      {grade: 'C', cost: 9000, tokens: 10, items: []},
    ]}],
  }});
  assert.equal(rows[0].grade, 'A');
  assert.equal(rows[0].name, 'Weekend Cup');
  assert.equal(rows[0].coinsPerToken, 600);
  assert.equal(rows[0].itemCount, 1);
  assert.equal(rows[1].coinsPerToken, 900);
  assert.equal(rows[2].coinsPerToken, null);
});

test('live collector follows the manifest version and gets both public feeds', async () => {
  const urls: string[] = [];
  const fetcher = async (url: string | URL | Request): Promise<Response> => {
    const value = String(url); urls.push(value);
    const payload = value.endsWith('/manifest.json') ? {'all-evolutions': 'ab12cd34'}
      : value.includes('all-evolutions.v1.') ? [{id: 7, name: 'Open Evo', endTime: '2099-01-01T00:00:00Z'}]
      : {data: {sets: []}};
    return new Response(JSON.stringify(payload), {status: 200, headers: {'content-type': 'application/json'}});
  };
  const result = await fetchFutggContext(99, fetcher as typeof fetch);
  assert.equal(result.evolutions[0].name, 'Open Evo');
  assert.equal(result.gallery.length, 0);
  assert(urls.some(url => url.endsWith('/all-evolutions.v1.ab12cd34.json')));
  assert(urls.some(url => url.endsWith('/api/fut/gallery/fc99/hub/')));
});
