import test from 'node:test';
import assert from 'node:assert/strict';
import {PriceRepository} from './prices.js';

test('price reads route console and PC to their own platform history',async()=>{
 const statements:string[]=[];
 const prices=new PriceRepository('postgresql://unused',27);
 (prices.pool.query as any)=async(sql:any)=>{statements.push(String(sql));return {rows:[]};};
 await prices.latest('100','ps5');
 await prices.history('100','pc',24);
 assert.match(statements[0],/FROM public\.futgg_bin_history/);
 assert.match(statements[1],/FROM public\.futbot_pc_bin_history/);
 await assert.rejects(prices.latest('100','xbox'),/Unsupported price platform/);
 await prices.pool.end();
});
