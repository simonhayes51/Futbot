import test from 'node:test';
import assert from 'node:assert/strict';
import {EmbedBuilder} from 'discord.js';
import {galleryPage,startGallery,handleGalleryButton} from './gallery-view.js';
import type {GalleryValue} from './futgg-context.js';
const tier:GalleryValue={setId:'1',name:'Test Gallery',grade:'S',cost:4650,tokens:30,coinsPerToken:155,itemCount:30,cardIds:Array.from({length:30},(_,n)=>String(n+1)),items:Array.from({length:30},(_,n)=>({id:String(n+1),price:(n+1)*10}))};
test('all 30 cards are reachable once through compact pages, with no raw ID label',()=>{
 const cards=new Map(tier.cardIds.map(id=>[id,{id,name:'Player '+id,rating:80,rarity:'Holographic',position:null,club:null,image:null}]));
 const lines=Array.from({length:4},(_,page)=>galleryPage(tier,cards,page).lines).flat();
 assert.equal(lines.length,30);assert.equal(new Set(lines).size,30);assert.match(lines[29],/Player 30/);assert(!lines.join('').includes('[ID '));assert.equal(galleryPage(tier,cards,999).page,3);assert.equal(galleryPage(tier,cards,-1).page,0);
});
test('Gallery navigation changes pages and tiers, blocks other users and never attaches a text file',async()=>{
 const d={...tier,grade:'D',cost:30,itemCount:1,items:[{id:'3',price:30}],cardIds:['3']};
 const reply=await startGallery('owner',[d,tier],()=>new EmbedBuilder(),async id=>({id,name:'Name '+id,rating:80,rarity:'Rare · Holographic',position:null,club:null,image:null}));
 assert.match(reply.embeds[0].toJSON().description!,/S tier/);assert.deepEqual(reply.files,[]);assert.deepEqual(reply.attachments,[]);assert.equal(reply.components.length,2);
 const next=reply.components[1].toJSON().components[1] as any;
 let denied:any;await handleGalleryButton({customId:next.custom_id,user:{id:'someone'},reply:async(v:any)=>{denied=v;}} as any);assert.match(denied.content,/your own/);
 let page:any;await handleGalleryButton({customId:next.custom_id,user:{id:'owner'},deferUpdate:async()=>{},editReply:async(v:any)=>{page=v;}} as any);assert.match(page.embeds[0].toJSON().fields[0].name,/Page 2 of 4/);assert.match(page.embeds[0].toJSON().description,/Name 9/);
 const down=reply.components[0].toJSON().components[1] as any;
 await handleGalleryButton({customId:down.custom_id,user:{id:'owner'},deferUpdate:async()=>{},editReply:async(v:any)=>{page=v;}} as any);assert.match(page.embeds[0].toJSON().description,/D tier/);
});
