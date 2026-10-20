import test from 'node:test';import assert from 'node:assert/strict';
import {extraCommands,handleTool} from './tools.js';import {EmbedBuilder} from 'discord.js';
test('one Evo command offers info and player; Gallery offers an optional tier',()=>{
 const list=extraCommands.map(c=>c.toJSON());assert.equal(list.length,15);assert.equal(new Set(list.map(c=>c.name)).size,15);
 assert(!list.some(c=>['evolution','evolutions'].includes(c.name)));
 const evo=list.find(c=>c.name==='evo')!;assert.deepEqual(evo.options?.map(o=>o.name),['info','player']);
 assert.equal((evo.options?.[0] as any).options[0].autocomplete,true);
 const gallery=list.find(c=>c.name==='gallery')!;assert.equal((gallery.options?.[0] as any).autocomplete,true);assert.equal(gallery.options?.[1].name,'tier');
 const sbc=list.find(c=>c.name==='sbc')!;assert.equal((sbc.options?.[0] as any).autocomplete,true);assert.equal(sbc.options?.[1].name,'market');
});
test('pause control scopes its update to the caller and current alert state',async()=>{let params:any;let reply:any;const interaction:any={commandName:'pausealert',user:{id:'owner'},options:{getString:()=> '123'},editReply:async(v:any)=>{reply=v;}};const repo:any={pool:{query:async(_sql:string,p:any)=>{params=p;return {rowCount:1};}}};await handleTool(interaction,{prices:{year:27},platform:'ps5'} as any,repo,()=>new EmbedBuilder(),async()=>{throw Error('unused');});assert.deepEqual(params,['paused','owner','123','active']);assert.match(reply,/paused/);});

test('empty watchlists explain how to save cards rather than suggesting a collector failure',async()=>{let reply:any;let snapshotCalls=0;const i:any={commandName:'watchlist',user:{id:'owner'},editReply:async(r:any)=>{reply=r;}};const market:any={prices:{year:27},platform:'ps5',snapshot:async()=>{snapshotCalls++;return [];}};const repo:any={pool:{query:async()=>({rows:[]})}};await handleTool(i,market,repo,()=>new EmbedBuilder(),async()=>{throw Error('unused');});assert.match(reply.embeds[0].toJSON().description,/watchlist is empty/);assert(!reply.embeds[0].toJSON().description.includes('collector'));assert.equal(snapshotCalls,0);});


test('Evo picks follow FUT.GG popularity rather than the cheapest three sample players',async()=>{
 const saved=globalThis.fetch;let reply:any;
 globalThis.fetch=async(input:any)=>new Response(JSON.stringify(String(input).includes('manifest')?{'all-evolutions':'1234abcd'}:String(input).includes('all-evolutions')?[{id:1,name:'Test Evo',endTime:'2099-01-01T00:00:00Z',numberOfPlayers:4291,eligiblePlayerItemIds:[7],trendingPlayersIds:['1_1','2_1','3_1','4_1','5_1','6_1'],customUnlockable:'100 tokens',description:'Improve your attackers.',requirementsText:[{label:'Overall',value:'Max. 83'}],levels:[{challenges:['Win 2 matches with your Evo player.']}],totalUpgradesText:[{label:'Pace',value:'+2'}]}]:{sets:[]}));
 try{
 const cards=[{id:'1',name:'Popular first',rating:83,rarity:'Gold',position:'ST',value:9000},{id:'2',name:'Popular second',rating:82,rarity:'Gold',position:'ST',value:500},...[3,4,5,6].map(id=>({id:String(id),name:'Popular '+id,rating:80,rarity:'Gold',position:'ST',value:300})),{id:'7',name:'Sample cheapest',rating:83,rarity:'Gold',position:'ST',value:200}];
 const market:any={platform:'ps5',maxAge:15,prices:{year:81,card:async(id:string)=>cards.find(c=>c.id===id)},snapshot:async()=>cards};
 await handleTool({commandName:'evo',options:{getSubcommand:()=> 'info',getString:(key:string)=>key==='evolution'?'1':null},editReply:async(r:any)=>{reply=r;}} as any,market,{} as any,()=>new EmbedBuilder(),async()=>{throw Error('unused');});
 const embed=reply.embeds[0].toJSON(),fields=embed.fields,picks=fields.find((f:any)=>f.name==='⭐ Popular picks').value;assert(picks.indexOf('Popular first')<picks.indexOf('Popular second'));assert(!picks.includes('Sample cheapest'));assert(!picks.includes('Popular 6'));assert.equal((picks.match(/\nGold/g)||[]).length,5);assert.match(embed.description,/100 tokens/);assert.deepEqual(fields.slice(0,4).map((f:any)=>f.name),['⚡ Upgrades','✅ Your card needs','🎮 Tasks','⭐ Popular picks']);assert.match(fields[0].value,/Pace: \+2/);assert.match(fields[1].value,/Max. 83/);assert.match(fields[2].value,/Win 2 matches/);assert(fields.every((f:any)=>f.value.length<=1024));
 }finally{globalThis.fetch=saved;}
});

test('player Evo command ranks the selected version and includes fees, finished stats and source links',async()=>{
 const saved=globalThis.fetch;let reply:any;let seenUrl='';
 globalThis.fetch=async(input:any)=>{seenUrl=String(input);return new Response(JSON.stringify({data:[{isExpired:false,wasUpgraded:true,coinsCost:5000,pointsCost:50,path:[{eaId:100,overall:80,facePace:70},{id:'100_11',eaId:100,evolutionId:11,overall:85,ggRating:90,facePace:85,skillMoves:4,weakFoot:4,url:'/players/42-name/evolutions/?id=100_11'}],evolutions:[{id:11,name:'Path one',endTime:'2099-01-01T00:00:00Z',endSubmissionTime:'2099-01-01T00:00:00Z'}]}],total:1,next:null}));};
 try{
 const market:any={platform:'ps5',prices:{year:86,evoIdentity:async(id:string)=>{assert.equal(id,'100');return {playerId:'42',url:'https://www.fut.gg/players/42-name/27-100/'};}},snapshot:async()=>[{id:'100',value:800}]};
 const i:any={commandName:'evo',options:{getSubcommand:()=> 'player',getString:(key:string)=>key==='player'?'100':null,getInteger:()=>null},editReply:async(r:any)=>{reply=r;}};
 await handleTool(i,market,{} as any,()=>new EmbedBuilder(),async()=>({id:'100',name:'Player',rating:80,rarity:'Rare',position:'ST',club:null,image:null}));
 assert.match(seenUrl,/player_item_ea_ids=100/);const embed=reply.embeds[0].toJSON();assert.match(embed.fields[0].value,/80 → 85 OVR · GG score 90.0/);assert.match(embed.fields[0].value,/5,000 coin fees/);assert.match(embed.fields[0].value,/PAC 70 → 85/);assert.match(reply.components[0].toJSON().components[0].url,/100_11/);
 }finally{globalThis.fetch=saved;}
});

test('an incomplete player search is labelled and omits unchanged face stats and the old wall of text',async()=>{
 const saved=globalThis.fetch;let reply:any;
 globalThis.fetch=async()=>new Response(JSON.stringify({data:[{isExpired:false,wasUpgraded:true,coinsCost:0,path:[{eaId:200,overall:79,facePace:86},{id:'200_12',eaId:200,evolutionId:12,overall:79,ggRating:81.7,facePace:86,url:'/players/43-player/evolutions/?id=200_12'}],evolutions:[{id:12,name:'Shooting Practice [SP+ 28]',customUnlockable:'Unlocked by reaching level 28 in the Premium Season Pass.',endTime:'2099-01-01T00:00:00Z'}]}],total:33,next:null}));
 try{
 const market:any={platform:'ps5',prices:{year:87,evoIdentity:async()=>({playerId:'43',url:'https://www.fut.gg/players/43-player/27-200/'})},snapshot:async()=>[]};
 await handleTool({commandName:'evo',options:{getSubcommand:()=> 'player',getString:(key:string)=>key==='player'?'200':null,getInteger:()=>null},editReply:async(r:any)=>{reply=r;}} as any,market,{} as any,()=>new EmbedBuilder(),async()=>({id:'200',name:'Player',rating:79,rarity:'Rare',position:'CAM',club:null,image:null}));
 const embed=reply.embeds[0].toJSON();assert.match(embed.description,/Search incomplete · 1 of 33/);assert.match(embed.fields[0].name,/Best returned route/);assert(!embed.fields[0].value.includes('PAC 86'));assert(!embed.fields[0].value.includes('[SP+'));assert.match(embed.fields[0].value,/Premium Season Pass · level 28 required/);assert(!embed.fields.some((f:any)=>f.name==='HOW THESE ARE RANKED'));assert(embed.fields[0].value.length<450);
 }finally{globalThis.fetch=saved;}
});
