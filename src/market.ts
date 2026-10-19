import type { PriceRepository } from './prices.js';
import {isFresh,type Card } from './domain.js';

export type MarketCard=Card&{value:number;capturedAt:Date;checkedAt:Date;previous:number|null;previousAt:Date|null;change:number|null};

const unavailablePriceStatuses=new Set(['bulk_no_market','no_active_market','untradeable']);

export function hasFreshPrice(checkedAt:Date,status:string|null,maxAgeMinutes:number,now=Date.now()){
  return !unavailablePriceStatuses.has(status??'')&&isFresh(checkedAt,maxAgeMinutes,now);
}

export function ratingValue(v:unknown,fallback=83){const n=Number(v??fallback);if(!Number.isInteger(n)||n<75||n>99)throw new Error('Rating must be a whole number from 75 to 99.');return n;}
export function targetValue(v:unknown){const n=Number(v);if(!Number.isInteger(n)||n<1||n>15000000)throw new Error('Price must be a whole coin amount from 1 to 15,000,000.');return n;}
export function fodderRows(cards:MarketCard[],rating?:number){const ratings=rating?[rating]:[83,84,85,86,87,88,89,90,91];return ratings.map(r=>({rating:r,cards:cards.filter(c=>c.rating===r).sort((a,b)=>a.value-b.value).slice(0,3)}));}
export function completeCard(c:MarketCard){return !!c.name?.trim()&&!/^unknown(?: card| player)?$/i.test(c.name.trim())&&Number.isInteger(c.rating)&&c.rating!>=1&&c.rating!<=99&&!!c.position&&Number.isFinite(c.value)&&c.value>0;}
export function movers(cards:MarketCard[],direction='risers',rarity?:string){return cards.filter(c=>completeCard(c)&&(c.rating??0)>=80&&c.value>=1000&&(!rarity||c.rarity===rarity)&&c.change!==null&&(direction==='fallers'?c.change<0:c.change>0)).sort((a,b)=>direction==='fallers'?a.change!-b.change!:b.change!-a.change!).slice(0,10);}
export function fodderIndex(cards:MarketCard[],rating:number){const values=cards.filter(c=>c.rating===rating&&completeCard(c)).sort((a,b)=>a.value-b.value).slice(0,3).map(c=>c.value).sort((a,b)=>a-b);return values.length===3?Math.round(values[1]):null;}

export class MarketService{
 private cached:{at:number;bucket:number;cards:MarketCard[]}|undefined;private pending:Promise<MarketCard[]>|undefined;
 constructor(public prices:PriceRepository,public platform:string,public maxAge=15){}
 async snapshot(){const bucket=Math.floor((Date.now()-60000)/300000);if(this.cached&&this.cached.bucket===bucket&&Date.now()-this.cached.at<300000)return this.cached.cards.filter(c=>hasFreshPrice(c.checkedAt,null,this.maxAge));if(this.pending)return this.pending;
 this.pending=this.load().then(cards=>{this.cached={at:Date.now(),bucket,cards};return cards;}).finally(()=>{this.pending=undefined;});return this.pending;}
 private async load():Promise<MarketCard[]>{
 const historyTable=this.platform==='pc'?'public.futbot_pc_bin_history':this.platform==='ps5'?'public.futgg_bin_history':null;
 if(!historyTable)throw new Error('Unsupported price platform. Choose PS5 or PC.');
 const {rows}=await this.prices.pool.query(`SELECT p.source_card_id::text AS id,
 COALESCE(p.display_name,p.name,p.full_name,'Unknown card') AS name,
 p.rating,p.primary_position AS position,p.rarity,p.club,
 COALESCE(p.card_image_stored_url,p.card_image_url,p.player_image_url) AS image,
 l.lowest_bin::int AS value,l.captured_at AS "capturedAt",
 CASE WHEN $2='ps5' THEN GREATEST(l.captured_at,COALESCE(p.price_checked_at,l.captured_at)) ELSE l.captured_at END AS "checkedAt",
 CASE WHEN $2='ps5' THEN p.last_price_status ELSE NULL END AS "priceStatus",
 b.lowest_bin::int AS previous,b.captured_at AS "previousAt"
 FROM public.futgg_players p
 JOIN LATERAL (
 SELECT h.lowest_bin,h.captured_at FROM ${historyTable} h
 WHERE h.source_card_id=p.source_card_id AND h.game_year=$1 AND h.platform=$2 AND h.lowest_bin>0
 ORDER BY h.captured_at DESC,h.id DESC LIMIT 1
 ) l ON true
 LEFT JOIN LATERAL (
 SELECT percentile_cont(0.5) WITHIN GROUP(ORDER BY h.lowest_bin)::int AS lowest_bin,max(h.captured_at) AS captured_at
 FROM ${historyTable} h
 WHERE h.source_card_id=p.source_card_id AND h.game_year=$1 AND h.platform=$2 AND h.lowest_bin>0
 AND h.captured_at BETWEEN now()-interval '25 hours' AND now()-interval '24 hours'
 HAVING count(*)>=3
 ) b ON true
 WHERE p.game_year=$1 AND p.is_active=true`,[this.prices.year,this.platform]);
 return rows.map(r=>({
   ...r,
   value:Number(r.value),
   checkedAt:new Date(r.checkedAt??r.capturedAt),
   priceStatus:r.priceStatus===null||r.priceStatus===undefined?null:String(r.priceStatus),
   previous:r.previous===null?null:Number(r.previous),
   change:r.previous?((Number(r.value)-Number(r.previous))/Number(r.previous))*100:null
 })).filter(r=>hasFreshPrice(r.checkedAt,r.priceStatus,this.maxAge)&&completeCard(r)).map(({priceStatus:_,...card})=>card);
 }
}
