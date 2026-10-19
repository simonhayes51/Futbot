import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {newStore,acceptPayload,buildReport,loadHar,contextForCard,collectLive,evolutionStatus} from './futgg-context.mjs';
const NOW=Date.parse('2026-10-19T17:32:00Z'), AT=new Date(NOW-60000).toISOString();
const EVO='https://r2.fut.gg/27/all-evolutions.v1.12345678.json';
const evo=(overrides={})=>({id:2596,game:'27',name:'Incisive Pass+',coinsCost:25000,pointsCost:250,
 endSubmissionTime:'2026-10-20T17:00:00Z',isExpired:false,eligiblePlayerItemIds:['50600878'],
 trendingPlayersIds:['50609974_2596'],...overrides});
const report=s=>buildReport(s,{now:NOW});

test('eligible evidence and trending evidence remain distinct and are never buy signals',()=>{
 const s=newStore();acceptPayload(s,EVO,[evo()],AT);const r=report(s);
 assert.equal(r.evolutions.length,1);assert.equal(r.watchCandidates.length,2);
 const a=r.watchCandidates.find(c=>c.cardId==='50600878');const b=r.watchCandidates.find(c=>c.cardId==='50609974');
 assert.equal(a.reasons[0].eligibilityConfirmed,true);assert.equal(b.reasons[0].eligibilityConfirmed,false);
 assert.equal(r.tradingSignal,false);assert.equal(a.tradingSignal,false);
 assert.equal(r.evolutions[0].eligibilityListIsComplete,false);
});

test('expired, unknown expiry, wrong-year and stale definitions do not enter watch candidates',()=>{
 const s=newStore();acceptPayload(s,EVO,[evo({id:1,isExpired:true}),evo({id:2,endSubmissionTime:null}),
 evo({id:3,endSubmissionTime:'2026-10-18T00:00:00Z'}),evo({id:4,game:'26'})],AT);
 assert.equal(report(s).watchCandidates.length,0);
 const old=newStore();acceptPayload(old,EVO,[evo()],'2026-10-01T00:00:00Z');assert.equal(report(old).watchCandidates.length,0);
 assert.equal(evolutionStatus({isExpired:false},NOW),'unknown');
});

test('the most recent capture wins regardless of HAR file order',()=>{
 const s=newStore();acceptPayload(s,EVO,[evo({name:'New'})],AT);acceptPayload(s,EVO,[evo({name:'Old'})],'2026-10-18T00:00:00Z');
 assert.equal(report(s).evolutions[0].name,'New');
});

test('each Gallery grade retains its own cost, rewards and exact lineup; zero cost is not advertised as free',()=>{
 const s=newStore();acceptPayload(s,'https://www.fut.gg/api/fut/gallery/fc27/hub/',{data:{categories:[{sets:[{id:1,name:'Example'}]}],
 sets:[{setId:1,costTiers:[{grade:'D',cost:6000,tokens:10,items:[{eaId:1,price:6000}]},
 {grade:'S',cost:25000,tokens:20,items:[{eaId:2,price:25000}]},{grade:'A',cost:0,tokens:10,items:[]}]}]}},AT);
 const r=report(s);assert.equal(r.gallery.length,3);assert.equal(r.gallery[0].coinsPerToken,600);
 assert.equal(r.gallery[1].items[0].cardId,'2');assert.equal(r.gallery[2].coinsPerToken,null);
 assert.equal(r.gallery[2].zeroOrMissingCostRequiresReview,true);
});

test('captured market evidence preserves observation times, excludes the other platform and never becomes a live BIN',()=>{
 const payload={data:{currentPrice:{platform:'ps5',priceUpdatedAt:AT},history:[{date:AT,price:110000}],
 momentum:{lastUpdates:[{updatedAt:AT,bin:109000}]},completedAuctions:[{soldDate:AT,soldPrice:108000}],
 overview:{discardValue:15300},priceRange:{minPrice:50000,maxPrice:500000}}};
 const s=newStore();acceptPayload(s,'https://www.fut.gg/api/fut/player-prices/27/50609974/?verify=SECRET',payload,AT);
 const r=report(s),e=r.playerContext['50609974'].capturedMarketEvidence;
 assert.equal(e.historicalBin[0].at,AT);assert.equal(e.completedSales[0].price,108000);
 assert.equal(e.neverImportAsLivePrice,true);assert.equal(JSON.stringify(r).includes('SECRET'),false);
 assert.equal(buildReport(s,{now:NOW,platform:'pc'}).playerContext['50609974'],undefined);
});

test('role scores and chemistry votes keep source IDs; they are not trading confidence',()=>{
 const s=newStore();acceptPayload(s,'https://www.fut.gg/api/fut/metarank/player/50609974/?game=27',
 {data:{scores:[{role:23,chemistryStyle:1,score:79.03,rank:162,isPlusPlus:true}]}},AT);
 acceptPayload(s,'https://www.fut.gg/api/fut/players/27/50609974/chemistry-style/',
 {data:{chemistryVotes:{'11':68,'17':21}}},AT);
 const c=report(s).playerContext['50609974'];assert.equal(c.roles.scores[0].score,79.03);
 assert.equal(c.chemistryVotes.styles[0].chemistryStyleId,'11');assert.equal(c.chemistryVotes.styles[0].votes,68);
});

test('player versions exclude old game years and evolved player instances',()=>{
 const s=newStore();acceptPayload(s,'https://www.fut.gg/api/fut/players/v2/all-versions/278326/',{data:[
 {eaId:1,game:'27',playerType:'players',firstName:'Example',lastName:'Player',overall:85},
 {eaId:2,game:'26',playerType:'players'},{eaId:3,game:'27',playerType:'evolutions'}]},AT);
 assert.deepEqual(Object.keys(report(s).playerContext),['1']);
});

test('evolution paths retain partial coverage and costs',()=>{
 const s=newStore();acceptPayload(s,'https://www.fut.gg/api/fut/evolutions/v2/27/paths/v2/278326/?player_item_ea_ids=50609974&number_of_evolutions__lte=1',
 {data:[{path:[{eaId:50609974},{eaId:50609974}],coinsCost:25000,evolutions:[{name:'Incisive Pass+'}]}],total:33,next:2},AT);
 const p=report(s).evolutionPaths[0];assert.equal(p.total,33);assert.equal(p.capturedCount,1);assert.equal(p.next,2);
 assert.equal(p.paths[0].coinsCost,25000);
});

test('private community properties never appear in exported variant context',()=>{
 const s=newStore();acceptPayload(s,'https://www.fut.gg/api/gg-club/community/holograph/',{data:{
 recent:[{username:'PRIVATE_EMAIL',card:{userId:123,purchasedFor:45000}}],catalogue:[{
 eaId:1,standardItemEaId:2,commonName:'Example',finish:'pristine',ownerCount:3,price:900000,
 card:{userId:123},username:'PRIVATE_EMAIL'}]}},AT);
 const r=report(s),out=JSON.stringify(r);assert.equal(r.variants.length,1);
 assert.equal(out.includes('PRIVATE_EMAIL'),false);assert.equal(out.includes('userId'),false);
 assert.equal(r.variants[0].ownershipIsNotMarketSupply,true);
});

test('consumer rejects stale, expired or mismatched context',()=>{
 const s=newStore();acceptPayload(s,EVO,[evo()],AT);const r=report(s);
 assert.ok(contextForCard(r,'50600878',{now:NOW}));
 assert.equal(contextForCard(r,'50600878',{now:NOW,year:26}),null);
 assert.equal(contextForCard(r,'50600878',{now:NOW,platform:'pc'}),null);
 assert.equal(contextForCard(r,'50600878',{now:NOW+7*3600000}),null);
 assert.equal(contextForCard(r,'50600878',{now:Date.parse('2026-10-20T18:00:00Z'),maxAgeMs:7*86400000}),null);
});

test('HAR loader supports body-bearing 304 and base64 while rejecting unrelated domains',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'futbot-context-'));
 try{
 const p=join(dir,'test.har');await writeFile(p,JSON.stringify({log:{entries:[{startedDateTime:AT,
 request:{url:EVO,headers:[{name:'cookie',value:'SECRET'}]},response:{status:304,content:{encoding:'base64',
 text:Buffer.from(JSON.stringify([evo()])).toString('base64')}}}]}}));
 const s=newStore();await loadHar(s,p);acceptPayload(s,'https://example.com/27/manifest.json',{},AT);
 assert.equal(report(s).evolutions.length,1);assert.equal(JSON.stringify(report(s)).includes('SECRET'),false);
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('live fetch is bounded, uses manifest versions, and never requests signed price or private club endpoints',async()=>{
 const urls=[];const s=newStore();await collectLive(s,{cardIds:['50609974'],basePlayerIds:['278326'],fetcher:async url=>{
 urls.push(url);let value=url.endsWith('manifest.json')?{'all-evolutions':'12345678'}:url.includes('all-evolutions')?[evo()]:{data:{}};
 return {ok:true,json:async()=>value};}});
 assert.equal(urls.length,7);assert.ok(urls.some(u=>u.endsWith('all-evolutions.v1.12345678.json')));
 assert.ok(!urls.some(u=>u.includes('price-access')||u.includes('player-prices')||u.includes('gg-club')));
});

test('blocked live responses are explicit errors',async()=>{
 const s=newStore();await collectLive(s,{fetcher:async()=>({ok:false,status:403})});
 assert.ok(s.errors.some(e=>e.reason==='HTTP 403'));assert.equal(s.snapshots.size,0);
});
