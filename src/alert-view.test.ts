import test from 'node:test';import assert from 'node:assert/strict';
import {alertPrices} from './alert-view.js';
test('alert display preserves targets, shares observations and withholds stale gaps',async()=>{
 let calls=0;const prices:any={year:27,latest:async()=>{calls++;return {value:21000,capturedAt:new Date()};}};
 const base={card_id:'1',platform:'ps5',game_year:27,direction:'above' as const,target:26000};
 const rows=await alertPrices([base,{...base,direction:'below' as const,target:20000},{...base,game_year:26}],prices,15);
 assert.equal(calls,1);assert.equal(rows[0].target,26000);assert.equal(rows[0].gap,5000);assert.equal(rows[1].gap,1000);assert.equal(rows[2].currentPrice,null);
 prices.latest=async()=>({value:21000,capturedAt:new Date(Date.now()-3600000)});
 const [stale]=await alertPrices([base],prices,15);assert.equal(stale.currentPrice,21000);assert.equal(stale.priceFresh,false);assert.equal(stale.gap,null);
 prices.latest=async()=>{throw Error('offline');};assert.equal((await alertPrices([base],prices,15))[0].currentPrice,null);
});
