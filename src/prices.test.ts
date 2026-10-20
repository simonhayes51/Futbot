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

test('missing Gallery items verify the exact holographic version without using a standard item price',async()=>{
 const prices=new PriceRepository('postgresql://unused',27),saved=globalThis.fetch,queries:string[]=[];
 (prices.pool.query as any)=async(sql:any)=>{queries.push(String(sql));return {rows:String(sql).includes('DISTINCT source_player_id')?[{playerId:'100'}]:[]};};
 globalThis.fetch=async()=>new Response(JSON.stringify({data:[{eaId:100,game:'27',commonName:'Standard',overall:80},{eaId:16777316,game:'27',commonName:'Holo player',overall:85,rarityName:'Rare',holographicType:'holographic',price:999}]}));
 try{const card=await prices.galleryCard('16777316');assert.equal(card?.name,'Holo player');assert.equal(card?.id,'16777316');assert.equal(card?.rating,85);assert(!('price' in card!));assert(queries.every(q=>!/(INSERT|UPDATE|DELETE)/.test(q)));}
 finally{globalThis.fetch=saved;await prices.pool.end();}
});

test('holo names resolve locally when FUT.GG is blocked, without borrowing normal-card details',async()=>{
 const {PGlite}=await import('@electric-sql/pglite');const db=new PGlite();
 await db.exec(`CREATE TABLE futgg_players(source_card_id bigint,source_player_id bigint,game_year int,display_name text,name text,full_name text,rating int,primary_position text,rarity text,club text,league text,card_image_stored_url text,card_image_url text,player_image_url text);
 INSERT INTO futgg_players(source_card_id,source_player_id,game_year,display_name,rating,rarity,card_image_url) VALUES(5661,5661,27,'Correct player',88,'Base Hero','https://example.com/normal.png'),(5661,5661,26,'Wrong season',99,'Old card',null),(5671,5671,27,'Card #5671',null,null,null),(16782887,5671,27,'Other synced player',80,'Rare',null);`);
 const prices=new PriceRepository('postgresql://unused',27),saved=globalThis.fetch;let network=0;
 (prices.pool.query as any)=async(sql:string,values:any[])=>db.query(sql,values);
 globalThis.fetch=async()=>{network++;return new Response('',{status:403});};
 try{
  const holo=await prices.galleryCard('67114525');
  assert.equal(holo?.name,'Correct player');assert.equal(holo?.id,'67114525');assert.equal(holo?.versionDetailsMissing,true);
  assert.equal(holo?.rating,null);assert.equal(holo?.rarity,null);assert.equal(holo?.image,null);assert(!('price' in holo!));assert.equal(network,0);
  const other=await prices.galleryCard('67114535');assert.equal(other?.name,'Other synced player');assert.equal(network,0);
 }finally{globalThis.fetch=saved;await prices.pool.end();await db.close();}
});
