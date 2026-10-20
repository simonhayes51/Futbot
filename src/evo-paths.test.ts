import test from 'node:test';
import assert from 'node:assert/strict';
import {normalisePlayerPaths,rankPlayerPaths,fetchPlayerPaths} from './evo-paths.js';
const future='2099-01-01T00:00:00Z';
function record(evos=[11],gg:number|null=90,coins=1000){
 const base={eaId:100,overall:80,position:25,facePace:75,faceShooting:70,facePassing:60,faceDribbling:80,faceDefending:40,facePhysicality:50};
 return {isExpired:false,wasUpgraded:true,coinsCost:coins,pointsCost:0,evolutionPathChoices:evos.map(()=>[]),path:[base,...evos.map((evo,index)=>({...base,id:'100_'+evos.slice(0,index+1).join('_'),evolutionId:evo,overall:81+index,ggRating:gg,facePace:80+index,skillMoves:4,weakFoot:4,url:'/players/42-name/evolutions/?id=100_'+evos.slice(0,index+1).join('_')}))],evolutions:evos.map(e=>({id:e,name:'Evo '+e,endTime:future,endSubmissionTime:future})),upgrades:{text:[{label:'PlayStyle+',value:'Technical'}]}};
}
test('player paths retain ordered multi-Evo stages and exact before/after stats',()=>{
 const [path]=normalisePlayerPaths({data:[record([12,11])]},'100',3);
 assert.deepEqual(path.names,['Evo 12','Evo 11']);assert.equal(path.ggRating,90);assert.equal(path.overall,82);assert.equal(path.startingOverall,80);assert.equal(path.coins,1000);assert.deepEqual(path.stats[0],{label:'PAC',before:75,after:81});assert.match(path.url,/100_12_11/);assert.deepEqual(path.upgrades,['PlayStyle+: Technical']);
});
test('wrong card versions, expired stages, incomplete stages and unverifiable availability are excluded',()=>{
 const expired=record();expired.evolutions[0].endTime='2020-01-01T00:00:00Z';
 const wrong=record();wrong.path[0].eaId=101;
 const partial:any=record();partial.path[1].partialEvolutionId=11;
 const unknown:any=record();delete unknown.isExpired;
 const unsafe:any=record();unsafe.path[1].url='https://example.com/players/42/';
 assert.equal(normalisePlayerPaths({data:[expired,wrong,partial,unknown,unsafe,record([1,2,3])]},'100',2).length,0);
});
test('GG rating leads ranking, missing GG follows rated paths, duplicates collapse, and coin fees break equal-result ties',()=>{
 const paths=normalisePlayerPaths({data:[record([1],92,10000),record([2],90,0),record([3],92,500),record([4],null,0),record([1],92,10000)]},'100');
 assert.deepEqual(rankPlayerPaths(paths).map(p=>p.id),['100_3','100_1','100_2','100_4']);
});
test('lookup uses base player identity and exact item ID, follows all pages and preserves returned chain order',async()=>{
 const urls:string[]=[];const fetcher=async(input:any)=>{const url=String(input);urls.push(url);return new Response(JSON.stringify(url.includes('page=2')?{data:[record([2,1],95)],next:null,total:2}:{data:[record([1],90)],next:2,total:2}));};
 const result=await fetchPlayerPaths(83,'42','100',3,fetcher as typeof fetch);
 assert.equal(result.fetched,2);assert.equal(result.complete,true);assert.deepEqual(result.paths[0].names,['Evo 2','Evo 1']);assert(urls[0].includes('/paths/v2/42/'));assert(urls[0].includes('player_item_ea_ids=100'));assert(urls[0].includes('number_of_evolutions__lte=3'));assert(urls[1].includes('page=2'));
});
test('large searches are explicitly partial and blocked lookups are errors, not empty recommendations',async()=>{
 const result=await fetchPlayerPaths(84,'42','100',3,(async(input:any)=>{const page=Number(new URL(String(input)).searchParams.get('page')??1);return new Response(JSON.stringify({data:[record([page])],next:page+1,total:100}));}) as typeof fetch);
 assert.equal(result.complete,false);assert.equal(result.fetched,10);assert.equal(result.total,100);
 await assert.rejects(fetchPlayerPaths(85,'42','100',3,(async()=>new Response('',{status:403})) as typeof fetch),/blocked/);
});
