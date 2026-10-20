import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {EmbedBuilder} from 'discord.js';
import {verifiedGalleryCard} from './gallery-catalogue.js';
import {galleryPage} from './gallery-view.js';
import {PriceRepository} from './prices.js';

test('verified metadata distinguishes exact Holographic and Pristine versions and never supplies prices',()=>{
 const morientes=verifiedGalleryCard(27,'67114525')!,mascherano=verifiedGalleryCard(27,'67251618')!;
 assert.equal(morientes.rating,87);assert.equal(morientes.rarity,'Base Hero · Holographic');assert.equal(morientes.position,'ST');
 assert.equal(mascherano.rating,88);assert.equal(mascherano.rarity,'Base Hero · Pristine Holographic');
 assert.equal(verifiedGalleryCard(26,'67114525'),null);assert.equal(verifiedGalleryCard(27,'5661'),null);assert(!('price' in morientes));
 assert.equal(verifiedGalleryCard(27,'67386507')?.rarity,'Team of the week');
 assert.equal(verifiedGalleryCard(27,'50609291')?.rarity,'Team of the week · Pristine Holographic');
});

test('every checked-in item has a matching year/item source URL and public metadata only',()=>{
 const data=JSON.parse(readFileSync(new URL('../data/gallery-cards.json',import.meta.url),'utf8'));const seen=new Set<string>();
 for(const row of data.cards){
  const key=`${row.year}:${row.id}`;assert(!seen.has(key));seen.add(key);assert.match(row.sourceUrl,new RegExp('/'+row.year+'-'+row.id+'/$'));
  const card=verifiedGalleryCard(row.year,row.id);assert(card);assert(!('price' in row));assert(!('username' in row));assert(!('userId' in row));
 }
 assert(data.cards.length>=55);
});

test('the screenshot’s missing variants render rating, finish and exact source link with their Gallery prices',()=>{
 const ids=['67114525','67119823','67135573','67251618','67186651','67322965'];
 const cards=new Map(ids.map(id=>[id,verifiedGalleryCard(27,id)]));
 const tier={setId:'109',name:'LALIGA EA SPORTS',grade:'B',cost:1710000,tokens:95,coinsPerToken:18000,itemCount:6,cardIds:ids,items:ids.map((id,n)=>({id,price:[148000,167000,342000,345000,363000,863000][n]}))};
 const view=galleryPage(tier,cards,0),text=view.lines.join('\n');
 assert.match(text,/Fernando Morientes/);assert.match(text,/87 OVR/);assert.match(text,/Base Hero · Holographic/);assert.match(text,/Pristine Holographic/);assert.match(text,/148,000 coins/);assert.match(text,/27-67114525/);assert(!text.includes('details unavailable'));
 new EmbedBuilder().setDescription(text).toJSON();
});

test('verified item metadata is available with web and database access both down',async()=>{
 const prices=new PriceRepository('postgresql://unused',27),saved=globalThis.fetch;let network=0,queries=0;
 (prices.pool.query as any)=async()=>{queries++;throw Error('database unavailable');};
 globalThis.fetch=async()=>{network++;return new Response('',{status:403});};
 try{const card=await prices.galleryCard('67114525');assert.equal(card?.rarity,'Base Hero · Holographic');assert.equal(card?.rating,87);assert.equal(queries,1);assert.equal(network,0);}
 finally{globalThis.fetch=saved;await prices.pool.end();}
});

test('a live exact-item rating takes priority while its verified finish stays attached',async()=>{
 const prices=new PriceRepository('postgresql://unused',27);
 prices.card=async id=>({id,name:'Cucurella',rating:89,position:'LB',rarity:'Destined for Glory',club:null,image:null});
 try{const card=await prices.galleryCard('67348095');assert.equal(card?.rating,89);assert.equal(card?.rarity,'Destined for Glory · Pristine Holographic');assert.equal(card?.id,'67348095');}
 finally{await prices.pool.end();}
});
