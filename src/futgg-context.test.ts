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

test('Evo metadata distinguishes the full count from samples and retains branching or chained popular paths',()=>{
 const [evo]=normaliseEvolutions([{id:2532,name:'Frontline Flair',endTime:'2099-01-01T00:00:00Z',endSubmissionTime:'2099-02-01T00:00:00Z',numberOfPlayers:4291,eligiblePlayerItemIds:[1,2,3],trendingPlayersIds:['99_2532:1','88_42_2532'],description:'Boost your attackers.',levels:[{challenges:['Play 1 match.']},{challenges:['Win 2 matches.']}],customUnlockable:'Unlocked via the Token Store for 100 tokens',url:'/evolutions/2532-frontline-flair/',requirementsText:[{label:'Overall',value:'Max. 83'}],totalUpgradesText:[{label:'Overall',value:'+1',maxValue:'(^84)'}]}]);
 assert.equal(evo.description,'Boost your attackers.');assert.deepEqual(evo.completion,['Level 1: Play 1 match.','Level 2: Win 2 matches.']);assert.equal(evo.playerCount,4291);assert.equal(evo.eligibleCardIds.length,3);
 assert.deepEqual(evo.popularPicks?.map(p=>[p.id,p.chained]),[['99',false],['88',true]]);
 assert.match(evo.unlock!,/100 tokens/);assert.deepEqual(evo.requirements,['Overall: Max. 83']);
 assert.deepEqual(evo.upgrades,['Overall: +1 (^84)']);
 const closed=normaliseEvolutions([{id:1,endTime:'2020-01-01T00:00:00Z',endSubmissionTime:'2099-01-01T00:00:00Z'}]);assert.equal(closed.length,0);
});

test('Gallery retains every completion item and its source price without dropping unresolved card IDs',()=>{
 const [tier]=normaliseGallery({sets:[{setId:1,costTiers:[{grade:'S',cost:600,tokens:10,items:[{eaId:1,price:100},{eaId:2,price:200},{eaId:3,price:300}]}]}]});
 assert.equal(tier.itemCount,3);assert.deepEqual(tier.items,[{id:'1',price:100},{id:'2',price:200},{id:'3',price:300}]);
});
