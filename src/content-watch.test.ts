import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {applyCapture,emptyState,definitions,makeCapture,readHar,decodeRules,matchPlayer,shortlist,clueRules,publicContentUrl,type Definition,type Player} from './content-watch.js';
import {fetchPublic,deliverPending,withLock,atomicJson,loadState,changeMessage} from './content-watch-runner.js';
import {playerFromRow} from './content-watch-players.js';
import vm from 'node:vm';
const date='2026-10-23T07:19:00.000Z';
const source='https://utas.mob.v1.prd.futc-ext.gcp.ea.com/ut/game/fc27/academy/hub/v2';
const evo=(rating=81)=>({categories:[{id:0,slotIds:[1,2]}],slots:[{id:1,slotName:'Test EVO',slotDescription:'Boost a striker',status:'NOT_STARTED',elgReqs:[{type:'PLAYER_ATTRIBUTE',eligibilitySlot:1,eligibilityValue:1},{type:'SCOPE',eligibilitySlot:1,eligibilityValue:1},{type:'ACADEMY_PLAYER_SLOTTING',eligibilitySlot:1,eligibilityValue:rating}],levels:[]}]});
const capture=(body=evo(),at=date)=>makeCapture([{url:source,capturedAt:at,body}],[],at);
const def=():Definition=>definitions(capture())[0];
const player:Player={id:'123',name:'Striker',rating:80,positions:['ST'],basePlayStyles:4,stats:{PACE:84},platform:'ps5',gameYear:27,price:700,priceCheckedAt:date};
test('HAR importer excludes session headers, account responses, progress and user squads',()=>{
 const body=evo();(body.slots[0] as any).randomPlayerPreview={itemData:{id:999,owner:'private'}};
 const har={log:{entries:[{startedDateTime:date,request:{method:'GET',url:source,headers:[{name:'X-UT-SID',value:'SECRET'}]},response:{status:200,content:{encoding:'base64',text:Buffer.from(JSON.stringify(body)).toString('base64')}}},{startedDateTime:date,request:{method:'GET',url:'https://gateway.ea.com/identity'},response:{status:200,content:{text:'{"SECRET":"email"}'}}}]}};
 const state=emptyState();applyCapture(state,readHar(har),true);assert.doesNotMatch(JSON.stringify(state),/SECRET|private|randomPlayerPreview|NOT_STARTED/);assert.deepEqual(state.coverage,{evoExpected:2,evoFetched:1});
});
test('baseline is silent, repeated imports are stable, requirements changes produce one event',()=>{
 const state=emptyState();assert.equal(applyCapture(state,capture(),true).length,0);assert.equal(applyCapture(state,capture()).length,0);
 const events=applyCapture(state,capture(evo(82),'2026-10-23T07:20:00.000Z'));assert.equal(events.length,1);assert.equal(events[0].type,'changed');assert.equal(state.records['evo:1'].firstSeen,date);
 assert.equal(applyCapture(state,capture()).length,0);assert.equal(state.records['evo:1'].definition.rules[0].targets[0],82);
});
test('account progress, countdown timers and random previews do not trigger changes',()=>{
 const state=emptyState();applyCapture(state,capture(),true);const body=evo();(body.slots[0] as any).status='IN_PROGRESS';(body.slots[0] as any).randomPlayerPreview={anything:Math.random()};assert.equal(applyCapture(state,capture(body)).length,0);
});
test('a partial public poll does not remove existing SBC/EVO definitions',()=>{
 const state=emptyState();applyCapture(state,capture(),true);applyCapture(state,makeCapture([]));assert.ok(state.records['evo:1']);
});
test('EA scope and position decoding matches captured enum values',()=>{
 const rules=decodeRules([{type:'PLAYER_ATTRIBUTE',eligibilitySlot:1,eligibilityValue:48},{type:'SCOPE',eligibilitySlot:1,eligibilityValue:2},{type:'ACADEMY_PLAYER_SLOTTING',eligibilitySlot:1,eligibilityValue:14},{type:'ADDITIONAL_TARGET_VALUE',eligibilitySlot:1,eligibilityValue:5}]);
 assert.equal(rules[0].attribute,'POSITION_NEGATED');assert.deepEqual(rules[0].targets,['CM','CB']);const d=def();d.rules=rules;assert.equal(matchPlayer(d,{...player,positions:['ST','CM']}).result,'ineligible');
});
test('Batigol clue checks alternate positions and remains unverified even when known limits pass',()=>{
 const description='The Evolution will be available on any Player Item with ST position, rated 81 or lower, with 7 or less Base PlayStyles, and max 85 PAC, excluding items with CM, CB, or CAM position.';
 const d={...def(),kind:'evo-clue' as const,evidence:'catalogue-text' as const,rules:clueRules(description)};
 assert.equal(d.rules.length,5);assert.equal(matchPlayer(d,player).result,'unverified');assert.equal(matchPlayer(d,{...player,positions:['ST','CAM']}).result,'ineligible');assert.equal(matchPlayer(d,{...player,rating:82}).result,'ineligible');
});
test('missing PlayStyle/position fields and unknown requirements never certify eligibility',()=>{
 const d=def();d.rules=[{attribute:'BASE_TRAITS_COUNT',scope:'max',targets:[7]}];assert.equal(matchPlayer(d,{id:'x',name:'Unknown'}).result,'unverified');d.rules=[{attribute:'UNKNOWN_999',scope:'exact',targets:[1]}];assert.equal(matchPlayer(d,player).result,'unverified');
});
test('numeric bounds and all supplied constraints must pass',()=>{
 const d=def();d.rules.push({attribute:'PACE',scope:'between',targets:[75,85]});assert.equal(matchPlayer(d,player).result,'eligible');assert.equal(matchPlayer(d,{...player,stats:{PACE:86}}).result,'ineligible');
});
test('SBC squad rules never become individual buy eligibility',()=>{
 const d={...def(),kind:'sbc-challenge' as const};assert.equal(matchPlayer(d,player).result,'unverified');
});
test('shortlist separates platform/year and suppresses stale, future and zero prices',()=>{
 const d=def();const rows=shortlist(d,[player,{...player,id:'pc',platform:'pc'},{...player,id:'oldgame',gameYear:26},{...player,id:'stale',priceCheckedAt:'2026-10-22T00:00:00Z'},{...player,id:'future',priceCheckedAt:'2026-10-24T00:00:00Z'},{...player,id:'zero',price:0}],'ps5',27,15,Date.parse(date));
 assert.equal(rows.length,4);assert.equal(rows[0].player.price,700);assert.ok(rows.slice(1).every(r=>r.player.price===undefined));
});
test('database adapter does not mistake primary position for complete positions or invent PlayStyles',()=>{
 const p=playerFromRow({source_card_id:1,name:'A',rating:80,primary_position:'ST'},27,'ps5');assert.equal(p.positions,undefined);assert.equal(p.basePlayStyles,undefined);
});
test('public fetch allowlist rejects authenticated endpoints, lookalike hosts and redirects',async()=>{
 const good='https://www.ea.com/ea-sports-fc/ultimate-team/web-app/loc/en-US.json';assert.ok(publicContentUrl(good));assert.equal(publicContentUrl(good+'?sid=SECRET'),false);assert.equal(publicContentUrl(good.replace('www.ea.com','www.ea.com.evil.test')),false);
 await assert.rejects(fetchPublic(source,async()=>{throw new Error('Must not fetch')}));
 const document=await fetchPublic(good,(async(_url,options)=>{assert.equal(options?.redirect,'error');assert.equal(options?.headers&&JSON.stringify(options.headers).includes('X-UT-SID'),false);return new Response('{"AcademySlot1":"New"}');}) as typeof fetch);assert.equal((document.body as any).AcademySlot1,'New');
 await assert.rejects(fetchPublic(good,(async()=>new Response('<html>error</html>')) as typeof fetch));
});
test('outbox retries failed delivery and remembers successful alerts',async()=>{
 const state=emptyState();applyCapture(state,capture());let calls=0,saves=0;
 await assert.rejects(deliverPending(state,async()=>{calls++;throw new Error('offline');},async()=>{saves++;}));assert.equal(state.events[0].delivered,undefined);
 assert.equal(await deliverPending(state,async()=>{calls++;},async()=>{saves++;}),1);assert.equal(await deliverPending(state,async()=>{calls++;},async()=>{saves++;}),0);assert.equal(calls,2);assert.equal(saves,1);
});
test('on-disk atomic state survives reload, and concurrent writers are rejected',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'futbot-content-test-'));try{await withLock(dir,async()=>{await atomicJson(join(dir,'state.json'),emptyState());await assert.rejects(withLock(dir,async()=>{}),/locked/);});assert.equal((await loadState(dir,27)).gameYear,27);assert.ok((await readFile(join(dir,'state.json'),'utf8')).includes('version'));}finally{await rm(dir,{recursive:true,force:true});}
});
test('catalogue clues are labelled as unconfirmed rather than promised early buys',()=>{
 const d={...def(),evidence:'catalogue-text' as const};const message=changeMessage({id:'1',key:d.key,at:date,type:'added',after:d});assert.match(message,/release unconfirmed/);assert.doesNotMatch(message,/buy now/i);
});
test('asset-root rotations with identical content do not create false changes',()=>{
 const url='https://www.ea.com/ea-sports-fc/ultimate-team/web-app/content/old/2027/fut/loc/companion/futweb/cdn/en-US.json';
 const state=emptyState();applyCapture(state,makeCapture([{url,capturedAt:date,body:{AcademySlot1:'Same name'}}],[],date),true);
 assert.equal(applyCapture(state,makeCapture([{url:url.replace('/old/','/new/'),capturedAt:date,body:{AcademySlot1:'Same name'}}],[],date)).length,0);
});
test('different game-year API responses cannot overwrite this game baseline',()=>{
 const state=emptyState();applyCapture(state,capture(),true);const olderGame=makeCapture([{url:source.replace('/fc27/','/fc26/'),capturedAt:date,body:evo(99)}],[],date);
 assert.equal(applyCapture(state,olderGame).length,0);assert.equal(state.records['evo:1'].definition.rules[0].targets[0],81);
});
test('browser collector paginates every advertised EVO and exports no session or progress data',async()=>{
 const code=await readFile(new URL('../scripts/ea-content-collector.js',import.meta.url),'utf8');
 class XHR{open(..._args:any[]){}setRequestHeader(..._args:any[]){}}
 const original=XHR.prototype.open,urls:string[]=[];let blob:Blob|undefined;
 class TestURL extends URL{static createObjectURL(value:Blob){blob=value;return 'blob:test';}static revokeObjectURL(_url:string){}}
 const root=source.replace('/academy/hub/v2','');const sandbox=vm.createContext({window:{},location:{origin:'https://www.ea.com',href:'https://www.ea.com/'},XMLHttpRequest:XHR,URL:TestURL,Blob,AbortSignal,
  document:{createElement:()=>({click(){}})},console:{log(){}},setTimeout:(f:()=>void)=>{queueMicrotask(f);return 1;},
  fetch:async(url:string,options:any)=>{urls.push(url);assert.equal(options.method,'GET');assert.equal(options.headers['X-UT-SID'],'SECRET');let body:any;
   if(url.endsWith('/sbs/hub/v2'))body={categories:[{sets:[{setId:4,name:'A',timesCompleted:99}]}]};
   else if(url.includes('/sbs/setId/'))body={challenges:[{challengeId:5,name:'A',squad:{private:'private'}}]};
   else if(url.endsWith('/academy/hub/v2'))body={categories:[{id:37,count:36,slotIds:Array.from({length:36},(_,i)=>i+1)}],slots:[]};
   else {const offset=Number(new URL(url).searchParams.get('offset'));body={slots:Array.from({length:offset===0?20:16},(_,i)=>({id:offset+i+1,slotName:'EVO',status:'private',randomPlayerPreview:{private:'private'},levels:[]}))};}
   return {ok:true,json:async()=>body};}});
 vm.runInContext(code,sandbox);const xhr=new XHR();xhr.open('GET',root+'/academy/hub/v2');xhr.setRequestHeader('X-UT-SID','SECRET');
 await (sandbox as any).window.FutbotContentWatch.collect();assert.equal(urls.length,5);assert.ok(urls.some(u=>u.includes('offset=20')));
 const exported=await blob!.text();assert.doesNotMatch(exported,/SECRET|private|timesCompleted|randomPlayerPreview/);assert.equal(JSON.parse(exported).documents.length,5);
 (sandbox as any).window.FutbotContentWatch.stop();assert.equal(XHR.prototype.open,original);
});
