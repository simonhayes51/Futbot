type Obj=Record<string,unknown>;
const object=(v:unknown):Obj=>v&&typeof v==='object'&&!Array.isArray(v)?v as Obj:{};
const list=(v:unknown):unknown[]=>Array.isArray(v)?v:[];
const number=(v:unknown):number|null=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
const id=(v:unknown)=>/^[1-9]\d*$/.test(String(v??''))?String(v):null;
const date=(v:unknown)=>typeof v==='string'&&Number.isFinite(Date.parse(v))?Date.parse(v):null;
export type PathStat={label:string;before:number|null;after:number|null};
export type PlayerEvoPath={
 id:string;url:string;names:string[];overall:number|null;startingOverall:number|null;ggRating:number|null;
 stats:PathStat[];skills:number|null;weakFoot:number|null;coins:number|null;points:number|null;
 unlocks:string[];upgrades:string[];startBy:number;finishBy:number;training:string|null;branches:boolean;
};
export type PlayerPathResults={paths:PlayerEvoPath[];fetched:number;total:number|null;complete:boolean;maxEvolutions:number};
export function pathUrl(value:unknown):string|null{
 if(typeof value!=='string'||value.length>512)return null;
 try{const url=new URL(value,'https://www.fut.gg');return url.origin==='https://www.fut.gg'&&url.pathname.startsWith('/players/')?url.href:null;}catch{return null;}
}
export function normalisePlayerPaths(payload:unknown,cardId:string,maxEvolutions=3,now=Date.now()):PlayerEvoPath[]{
 return list(object(payload).data).flatMap(raw=>{
  const row=object(raw),states=list(row.path).map(object),first=states[0],last=states.at(-1);
  if(row.isExpired!==false||row.wasUpgraded!==true||!first||!last||id(first.eaId)!==cardId||states.length<2||states.length-1>maxEvolutions)return [];
  const definitions=list(row.evolutions).map(object),byId=new Map(definitions.map(e=>[id(e.id),e]));
  const stages=states.slice(1).map(state=>byId.get(id(state.evolutionId)));
  if(stages.some((e,index)=>!e||e.isExpired===true||states[index+1].partialEvolutionId!=null))return [];
  const evos=stages as Obj[],starts=evos.map(e=>date(e.endTime)),ends=evos.map(e=>date(e.endSubmissionTime??e.endTime));
  if(starts.some(d=>d===null||d<=now)||ends.some(d=>d===null||d<=now))return [];
  const url=pathUrl(last.url);if(!url||typeof last.id!=='string'||!last.id.includes('_'))return [];
  const fields=first.position===0?[['DIV','gkFaceDiving'],['HAN','gkFaceHandling'],['KIC','gkFaceKicking'],['REF','gkFaceReflexes'],['SPD','gkFaceSpeed'],['POS','gkFacePositioning']]:[['PAC','facePace'],['SHO','faceShooting'],['PAS','facePassing'],['DRI','faceDribbling'],['DEF','faceDefending'],['PHY','facePhysicality']];
  const unlocks=evos.flatMap(e=>{const details=typeof e.customUnlockable==='string'&&e.customUnlockable.trim()?e.customUnlockable.trim():number(e.tokenCost)?`${e.tokenCost} tokens`:typeof e.sbcName==='string'?'SBC unlock: '+e.sbcName:typeof e.objectiveGroupName==='string'?'Objective unlock: '+e.objectiveGroupName:e.isRewardEvolution===true?'Reward unlock required — check source':null;return details?[`${e.name??'Evolution'}: ${details}`]:[];});
  const upgrades=list(object(row.upgrades).text).flatMap(v=>{const t=object(v);return typeof t.label==='string'&&typeof t.value==='string'&&t.label!=='Rarity'?[`${t.label}: ${t.value}`]:[];});
  return [{id:last.id,url,names:evos.map(e=>String(e.name??'Evolution')),overall:number(last.overall),startingOverall:number(first.overall),ggRating:number(last.ggRating),
   stats:fields.map(([label,key])=>({label,before:number(first[key]),after:number(last[key])})),skills:number(last.skillMoves),weakFoot:number(last.weakFoot),coins:number(row.coinsCost),points:number(row.pointsCost),
   unlocks:[...new Set(unlocks)],upgrades,startBy:Math.min(...starts as number[]),finishBy:Math.min(...ends as number[]),training:typeof row.readableTrainingTime==='string'?row.readableTrainingTime:null,
   branches:list(row.evolutionPathChoices).some(v=>list(v).length>0)}];
 });
}
export function rankPlayerPaths(paths:PlayerEvoPath[]):PlayerEvoPath[]{
 const unique=[...new Map(paths.map(p=>[p.id,p])).values()];
 return unique.sort((a,b)=>(b.ggRating??-1)-(a.ggRating??-1)||(b.overall??-1)-(a.overall??-1)||(a.coins??Infinity)-(b.coins??Infinity)||a.names.length-b.names.length||a.id.localeCompare(b.id));
}
const cache=new Map<string,{until:number;result:Promise<PlayerPathResults>}>();
export function fetchPlayerPaths(year:number,playerId:string,cardId:string,maxEvolutions=3,fetcher:typeof fetch=fetch):Promise<PlayerPathResults>{
 if(!Number.isInteger(year)||year<20||year>99||!id(playerId)||!id(cardId)||![1,2,3].includes(maxEvolutions))throw new Error('Choose a valid card and between one and three Evolutions.');
 const key=[year,playerId,cardId,maxEvolutions].join(':');const hit=cache.get(key);if(hit&&hit.until>Date.now())return hit.result.then(result=>({...result,paths:result.paths.filter(path=>path.startBy>Date.now()&&path.finishBy>Date.now())}));
 const result=(async()=>{
  let page=1,fetched=0,total:number|null=null,complete=false;const paths:PlayerEvoPath[]=[],seen=new Set<number>(),deadline=Date.now()+25000;
  for(let count=0;count<10;count++){
   if(Date.now()>=deadline)break;if(seen.has(page))throw new Error('FUT.GG repeated a page of Evolution paths.');seen.add(page);
   const url=new URL(`https://www.fut.gg/api/fut/evolutions/v2/${year}/paths/v2/${playerId}/`);
   url.searchParams.set('player_item_ea_ids',cardId);url.searchParams.set('number_of_evolutions__lte',String(maxEvolutions));if(page>1)url.searchParams.set('page',String(page));
   const response=await fetcher(url.href,{headers:{accept:'application/json'},signal:AbortSignal.timeout(Math.max(1,Math.min(8000,deadline-Date.now())))});
   if(!response.ok)throw new Error(response.status===403?'FUT.GG blocked the Evolution-path lookup. Try again later or open the player on FUT.GG.':`FUT.GG could not load Evolution paths (HTTP ${response.status}).`);
   const payload=object(await response.json());if(!Array.isArray(payload.data))throw new Error('FUT.GG returned an unexpected Evolution-path response.');
   fetched+=payload.data.length;total=number(payload.total)??total;paths.push(...normalisePlayerPaths(payload,cardId,maxEvolutions));
   if(payload.next==null){complete=total===null||fetched>=total;break;}
   const next=Number(payload.next);if(!Number.isInteger(next)||next<=page)throw new Error('FUT.GG returned an invalid path page.');page=next;
  }
  return {paths:rankPlayerPaths(paths),fetched,total,complete,maxEvolutions};
 })().catch(error=>{cache.delete(key);throw error;});
 for(const [k,v]of cache)if(v.until<=Date.now())cache.delete(k);if(cache.size>=100)cache.delete(cache.keys().next().value!);
 cache.set(key,{until:Date.now()+300000,result});return result;
}
