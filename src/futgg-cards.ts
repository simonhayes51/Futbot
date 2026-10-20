import type {Card} from './domain.js';

const object=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const text=(v:unknown)=>typeof v==='string'?v.trim():'';
const number=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v:null;
export const namedCard=(card:Card|null|undefined):card is Card=>!!card&&!!card.name?.trim()&&!/^(unknown(?: card| player)?|card #\d+)$/i.test(card.name.trim());

// Only accept the exact EA item, including its finish. Never substitute a normal
// card's name/rating/price for an unverified holographic version.
export function exactVersion(payload:unknown,id:string,year:number):Card|null{
 const data=object(payload).data??payload;
 const visit=(values:unknown[]):Card|null=>{
  for(const value of values){
   const row=object(value);
   if(String(row.eaId)===id&&String(row.game)===String(year)){
    const name=text(row.commonName)||[text(row.firstName),text(row.lastName)].filter(Boolean).join(' ');
    if(!name)continue;
    const rarity=text(row.rarityName)||text(object(row.rarity).name)||'Player item';
    const finish=text(row.holographicType);
    return {id,name,rating:number(row.overall),position:null,rarity:finish?`${rarity} · ${finish==='holographic'?'Holographic':finish}`:rarity,club:null,image:text(row.cardImageUrl)||null};
   }
   if(Array.isArray(row.itemVariants)){const match=visit(row.itemVariants);if(match)return match;}
  }
  return null;
 };
 return visit(Array.isArray(data)?data:[]);
}
const cache=new Map<string,{until:number,value:Promise<Card|null>}>();
export async function fetchExactVersion(year:number,playerId:string,id:string,fetcher:typeof fetch=fetch):Promise<Card|null>{
 if(!/^\d+$/.test(playerId)||!/^\d+$/.test(id))return null;
 const key=`${year}:${playerId}:${id}`,hit=cache.get(key);
 if(hit&&hit.until>Date.now())return hit.value;
 const value=(async()=>{
  const response=await fetcher(`https://www.fut.gg/api/fut/players/v2/all-versions/${playerId}/`,{headers:{accept:'application/json'},signal:AbortSignal.timeout(5000)});
  if(!response.ok)return null;
  return exactVersion(await response.json(),id,year);
 })().catch(()=>null);
 if(cache.size>=500)cache.delete(cache.keys().next().value!);
 cache.set(key,{until:Date.now()+300000,value});return value;
}

export function holographicCards(payload:unknown,year:number):Map<string,Card>{
 const root=object(object(payload).data??payload),rows:unknown[]=[];
 // Whitelist public card definitions. Ignore usernames, owners and club data.
 for(const key of ['recent','valuable','catalogue']){
  const values=root[key];if(!Array.isArray(values))continue;
  for(const value of values){const row=object(value),card=object(row.card),definition=row.playerDef??card.playerDef??row.card;if(definition)rows.push(definition);}
 }
 const cards=new Map<string,Card>();
 for(const row of rows){const id=String(object(row).eaId??'');if(!/^[1-9]\d*$/.test(id))continue;const card=exactVersion(rows,id,year);if(card)cards.set(id,card);}
 return cards;
}
const holographCache=new Map<number,{until:number,value:Promise<Map<string,Card>>}>();
export async function fetchHolographicCard(year:number,id:string,fetcher:typeof fetch=fetch):Promise<Card|null>{
 let hit=holographCache.get(year);
 if(!hit||hit.until<Date.now()){
  const value=(async()=>{
   const response=await fetcher('https://www.fut.gg/api/gg-club/community/holograph/?finish=all',{headers:{accept:'application/json'},signal:AbortSignal.timeout(5000)});
   return response.ok?holographicCards(await response.json(),year):new Map<string,Card>();
  })().catch(()=>new Map<string,Card>());
  if(holographCache.size>=5)holographCache.delete(holographCache.keys().next().value!);
  hit={until:Date.now()+300000,value};holographCache.set(year,hit);
 }
 return (await hit.value).get(id)??null;
}
