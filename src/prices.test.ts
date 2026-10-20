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

test('Evolution identity resolves the base player separately from the exact card ID and game year',async()=>{
 const prices=new PriceRepository('postgresql://unused',27);let params:any,statement='';
 (prices.pool.query as any)=async(sql:any,p:any)=>{statement=String(sql);params=p;return {rows:[{playerId:'278326',url:'https://www.fut.gg/players/278326-alphadjo-cisse/27-50609974/'}]};};
 const result=await prices.evoIdentity('50609974');assert.equal(result?.playerId,'278326');assert.deepEqual(params,['50609974',27]);assert.match(statement,/source_player_id/);assert.match(statement,/source_card_id=\$1 AND game_year=\$2/);await prices.pool.end();
});
