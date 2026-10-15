import {isFresh,coins,type Direction} from './domain.js';
import type {PriceRepository} from './prices.js';
type SavedTarget={card_id:string;platform:string;game_year:number;target:string|number;direction:Direction};
export async function alertPrices<T extends SavedTarget>(rows:T[],prices:PriceRepository,maxAge:number){
 const cache=new Map<string,Promise<Awaited<ReturnType<PriceRepository['latest']>>>>();
 return Promise.all(rows.map(async a=>{
  const key=`${a.game_year}:${a.platform}:${a.card_id}`;
  if(a.game_year!==prices.year)return {...a,currentPrice:null,priceCapturedAt:null,priceFresh:false,gap:null};
  if(!cache.has(key))cache.set(key,prices.latest(a.card_id,a.platform).catch(()=>null));
  const p=await cache.get(key),fresh=!!p&&isFresh(p.capturedAt,maxAge);
  return {...a,currentPrice:p?.value??null,priceCapturedAt:p?.capturedAt??null,priceFresh:fresh,gap:fresh?Math.max(0,a.direction==='below'?p!.value-Number(a.target):Number(a.target)-p!.value):null};
 }));
}
export function alertPriceText(a:{currentPrice:number|null;priceFresh:boolean;priceCapturedAt:Date|null}){
 if(a.currentPrice===null)return 'Unavailable';
 return `${coins(a.currentPrice)} coins${a.priceFresh?'':' · ⚠ stale'}${a.priceCapturedAt?` · <t:${Math.floor(a.priceCapturedAt.getTime()/1000)}:R>`:''}`;
}
