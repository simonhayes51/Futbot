import test from 'node:test';
import assert from 'node:assert/strict';
import {applyCapture,emptyState,makeCapture,definitions,type Definition} from './content-watch.js';
import {assessRelease,unreleasedReason,queueUnreleased} from './content-watch-unreleased.js';
import {deliverPending,report} from './content-watch-runner.js';
import {watchSummary} from './content-watch-upload.js';
const now=Date.parse('2026-10-23T12:00:00Z');
const xmlUrl='https://www.ea.com/ea-sports-fc/ultimate-team/web-app/content/AAA/2027/fut/packs/loc/storepackdescriptions.en_us.xml';
function fixture(){
 const state=emptyState();const xml='<xliff><file><body>'+[['20304','Twilight Screamer EVO Pack','Includes 1 Batigol Precision Evolution Consumable. Player Item with ST position, rated 81 or lower, max 85 PAC.'],['20301','Scream Cornucopia Pack','Includes 15 Gold Player Items.'],['851','Ultimate Scream Player','Guarantees 1 Ultimate Scream player.']].map(([id,name,desc])=>`<trans-unit resname="FUT_STORE_PACK_${id}_NAME"><source>${name}</source></trans-unit><trans-unit resname="FUT_STORE_PACK_${id}_DESC"><source>${desc}</source></trans-unit>`).join('')+'</body></file></xliff>';
 const capture=makeCapture([{url:xmlUrl,capturedAt:new Date(now).toISOString(),body:xml}]);applyCapture(state,capture,true);return {state,capture};
}
test('public pack extraction includes ordinary packs, without declaring every catalogue entry unreleased',()=>{
 const {state,capture}=fixture();assert.equal(definitions(capture).length,3);
 assert.ok(unreleasedReason(state,state.records['evo-clue:pack-20304'].definition,now));
 assert.equal(unreleasedReason(state,state.records['pack-clue:pack-20301'].definition,now),undefined);
 assert.equal(unreleasedReason(state,state.records['pack-clue:pack-851'].definition,now),undefined);
 // The one dated setup confirmation must not remain valid indefinitely.
 assert.equal(unreleasedReason(state,state.records['evo-clue:pack-20304'].definition,now+86400000),undefined);
});
test('newly captured live items and old pending alerts never enter unreleased delivery',async()=>{
 const {state}=fixture();const live:Definition={key:'evo:123',kind:'evo',id:'123',name:'Already live',description:'',source:'/academy/hub/v2',rules:[],details:{},evidence:'served-definition'};
 state.records[live.key]={definition:live,hash:'live',firstSeen:new Date(now).toISOString(),lastSeen:new Date(now).toISOString()};state.events.push({id:'old-pending',key:live.key,at:new Date(now).toISOString(),type:'added',after:live});
 // Use an explicit current confirmation so this test does not depend on the wall clock.
 assessRelease(state,'evo-clue:pack-20304','unreleased');queueUnreleased(state);const sent:string[]=[];
 assert.equal(await deliverPending(state,async e=>{sent.push(e.key);},async()=>{}),1);assert.deepEqual(sent,['evo-clue:pack-20304']);assert.equal(state.events[0].delivered,undefined);
 const summary=watchSummary(state,{});assert.equal(summary.unreleased.length,1);assert.equal(summary.pendingAlerts,0);assert.ok(summary.recent.every(e=>e.name!=='Already live'));assert.doesNotMatch(report(state,[],'ps5',15),/Already live|Scream Cornucopia/);
});
test('marking a pack released suppresses queued and future alerts and removes it from the view',async()=>{
 const {state}=fixture();assessRelease(state,'evo-clue:pack-20304','unreleased');assert.equal(watchSummary(state,{}).unreleased.length,1);
 assessRelease(state,'evo-clue:pack-20304','released');assert.equal(watchSummary(state,{}).unreleased.length,0);assert.equal(watchSummary(state,{}).pendingAlerts,0);
 assert.equal(await deliverPending(state,async()=>{assert.fail('released content sent');},async()=>{}),0);
});
test('unreleased confirmations expire and future timestamps stop qualifying at release time',()=>{
 const {state}=fixture();assessRelease(state,'pack-clue:pack-20301','unreleased',now);const d=state.records['pack-clue:pack-20301'].definition;assert.ok(unreleasedReason(state,d,now));assert.equal(unreleasedReason(state,d,now+86400000),undefined);
 const future:Definition={key:'sbc:1',kind:'sbc',id:'1',name:'Future SBC',description:'',source:'/sbs/hub/v2',rules:[],details:{},evidence:'served-definition',release:now/1000+60};assert.ok(unreleasedReason(state,future,now));assert.equal(unreleasedReason(state,future,now+60000),undefined);
});

test('release assessment rejects inherited object keys',()=>{const {state}=fixture();assert.throws(()=>assessRelease(state,'__proto__','unreleased'),/not found/);});
