import type {Card} from './domain.js';

const object=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const text=(v:unknown)=>typeof v==='string'?v.trim():'';
const number=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)?v:null;
export const namedCard=(card:Card|null|undefined):card is Card=>!!card&&!!card.name?.trim()&&!/^(unknown(?: card| player)?(?:\s*#?\s*\d+)?|(?:card|player|item)\s*#?\s*\d+|\d+)$/i.test(card.name.trim());

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
    return {id,name,rating:number(row.overall),position:null,rarity:finish?`${rarity} · ${finish==='holographic'?'Holographic':finish==='pristine'?'Pristine Holographic':finish}`:rarity,club:null,image:text(row.cardImageUrl)||null};
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
   const deadline=Date.now()+10000;
   const get=async(url:string)=>{
    if(Date.now()>=deadline)return null;
    try{const response=await fetcher(url,{headers:{accept:'application/json'},signal:AbortSignal.timeout(Math.max(1,Math.min(5000,deadline-Date.now())))});return response.ok?await response.json():null;}catch{return null;}
   };
   const url='https://www.fut.gg/api/gg-club/community/holograph/?finish=all';
   const first=await get(url),cards=holographicCards(first,year),root=object(object(first).data??first);
   const pages=typeof root.cataloguePages==='number'?Math.min(25,Math.floor(root.cataloguePages)):1;
   if(pages<=1||root.cataloguePage!==1)return cards;
   const merge=(payload:unknown,page:number)=>{const row=object(object(payload).data??payload);if(row.cataloguePage!==page)return false;for(const [id,card]of holographicCards(payload,year))cards.set(id,card);return true;};
   // Accept a pagination parameter only after the source confirms page 2.
   // An ignored parameter must never be mistaken for a complete catalogue.
   let parameter:string|null=null;
   for(const key of ['page','catalogue_page','cataloguePage']){
    const next=await get(url+'&'+key+'=2');if(merge(next,2)){parameter=key;break;}
   }
   if(!parameter)return cards;
   for(let page=3;page<=pages&&Date.now()<deadline;page+=4){
    const numbers=Array.from({length:Math.min(4,pages-page+1)},(_,n)=>page+n);
    const results=await Promise.all(numbers.map(n=>get(url+'&'+parameter+'='+n)));
    results.forEach((payload,index)=>merge(payload,numbers[index]));
   }
   return cards;
  })().catch(()=>new Map<string,Card>());
  if(holographCache.size>=5)holographCache.delete(holographCache.keys().next().value!);
  hit={until:Date.now()+300000,value};holographCache.set(year,hit);
 }
 return (await hit.value).get(id)??null;
}
