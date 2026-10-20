import test from 'node:test';import assert from 'node:assert/strict';
import {extraCommands,handleTool} from './tools.js';import {EmbedBuilder} from 'discord.js';
test('new slash command payloads serialize with distinct valid names and searchable Evo/Gallery choices',()=>{const list=extraCommands.map(c=>c.toJSON());assert.equal(list.length,14);assert.equal(new Set(list.map(c=>c.name)).size,14);assert(list.some(c=>c.name==='fodder'));assert(list.some(c=>c.name==='pausealert'));const evo=list.find(c=>c.name==='evolutions')!,gallery=list.find(c=>c.name==='gallery')!;assert.equal(evo.options?.[0].name,'evolution');assert.equal((evo.options?.[0] as any).autocomplete,true);assert.equal(gallery.options?.[0].name,'set');assert.equal((gallery.options?.[0] as any).autocomplete,true);});
test('pause control scopes its update to the caller and current alert state',async()=>{let params:any;let reply:any;const interaction:any={commandName:'pausealert',user:{id:'owner'},options:{getString:()=> '123'},editReply:async(v:any)=>{reply=v;}};const repo:any={pool:{query:async(_sql:string,p:any)=>{params=p;return {rowCount:1};}}};await handleTool(interaction,{prices:{year:27},platform:'ps5'} as any,repo,()=>new EmbedBuilder(),async()=>{throw Error('unused');});assert.deepEqual(params,['paused','owner','123','active']);assert.match(reply,/paused/);});

test('empty watchlists explain how to save cards rather than suggesting a collector failure',async()=>{let reply:any;let snapshotCalls=0;const i:any={commandName:'watchlist',user:{id:'owner'},editReply:async(r:any)=>{reply=r;}};const market:any={prices:{year:27},platform:'ps5',snapshot:async()=>{snapshotCalls++;return [];}};const repo:any={pool:{query:async()=>({rows:[]})}};await handleTool(i,market,repo,()=>new EmbedBuilder(),async()=>{throw Error('unused');});assert.match(reply.embeds[0].toJSON().description,/watchlist is empty/);assert(!reply.embeds[0].toJSON().description.includes('collector'));assert.equal(snapshotCalls,0);});


test('Evo picks follow FUT.GG popularity rather than the cheapest three sample players',async()=>{
 const saved=globalThis.fetch;let reply:any;
 globalThis.fetch=async(input:any)=>new Response(JSON.stringify(String(input).includes('manifest')?{'all-evolutions':'1234abcd'}:String(input).includes('all-evolutions')?[{id:1,name:'Test Evo',endTime:'2099-01-01T00:00:00Z',numberOfPlayers:4291,eligiblePlayerItemIds:[7],trendingPlayersIds:['1_1','2_1','3_1','4_1','5_1','6_1'],customUnlockable:'100 tokens',description:'Improve your attackers.',requirementsText:[{label:'Overall',value:'Max. 83'}],levels:[{challenges:['Win 2 matches with your Evo player.']}],totalUpgradesText:[{label:'Pace',value:'+2'}]}]:{sets:[]}));
 try{
 const cards=[{id:'1',name:'Popular first',rating:83,rarity:'Gold',position:'ST',value:9000},{id:'2',name:'Popular second',rating:82,rarity:'Gold',position:'ST',value:500},...[3,4,5,6].map(id=>({id:String(id),name:'Popular '+id,rating:80,rarity:'Gold',position:'ST',value:300})),{id:'7',name:'Sample cheapest',rating:83,rarity:'Gold',position:'ST',value:200}];
 const market:any={platform:'ps5',maxAge:15,prices:{year:81,card:async(id:string)=>cards.find(c=>c.id===id)},snapshot:async()=>cards};
 await handleTool({commandName:'evolutions',options:{getString:(key:string)=>key==='evolution'?'1':null},editReply:async(r:any)=>{reply=r;}} as any,market,{} as any,()=>new EmbedBuilder(),async()=>{throw Error('unused');});
 const embed=reply.embeds[0].toJSON(),fields=embed.fields,picks=fields.find((f:any)=>f.name==='RECOMMENDED PICKS · FUT.GG TRENDING').value;assert(picks.indexOf('Popular first')<picks.indexOf('Popular second'));assert(!picks.includes('Sample cheapest'));assert(!picks.includes('Popular 6'));assert.equal((picks.match(/base OVR/g)||[]).length,5);assert.match(embed.description,/100 tokens/);assert.deepEqual(fields.slice(0,4).map((f:any)=>f.name),['WHAT IT DOES','WHAT YOU NEED','TO COMPLETE','RECOMMENDED PICKS · FUT.GG TRENDING']);assert.match(fields[0].value,/Pace: \+2/);assert.match(fields[1].value,/Max. 83/);assert.match(fields[2].value,/Win 2 matches/);assert(fields.every((f:any)=>f.value.length<=1024));
 }finally{globalThis.fetch=saved;}
});

test('Gallery shows the complete S solution even when D has cheaper tokens and preserves unknown cards in the attachment',async()=>{
 const saved=globalThis.fetch;let reply:any;
 globalThis.fetch=async(input:any)=>new Response(JSON.stringify(String(input).includes('manifest')?{'all-evolutions':'1234abcd'}:String(input).includes('all-evolutions')?[]:{categories:[{sets:[{id:1,name:'Test club'}]}],sets:[{setId:1,costTiers:[{grade:'D',cost:100,tokens:20,items:[{eaId:9,price:100}]},{grade:'S',cost:600,tokens:30,items:[{eaId:1,price:100},{eaId:2,price:200},{eaId:3,price:300}]}]}]}));
 try{
 const market:any={platform:'ps5',prices:{year:82,card:async(id:string)=>id==='2'?null:{id,name:'Player '+id,rating:80,rarity:'Gold'}}};
 await handleTool({commandName:'gallery',options:{getString:()=> '1'},editReply:async(r:any)=>{reply=r;}} as any,market,{} as any,()=>new EmbedBuilder(),async()=>{throw Error('unused');});
 const desc=reply.embeds[0].toJSON().description;assert.match(desc,/S completion/);assert.match(desc,/600 coins/);assert.match(desc,/Card #2/);
 const attachment=reply.files[0].attachment.toString();for(const id of ['1','2','3'])assert(attachment.includes('[ID '+id+']'));assert.match(attachment,/Item subtotal: 600 coins/);
 }finally{globalThis.fetch=saved;}
});
