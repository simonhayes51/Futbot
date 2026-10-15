import type { PriceRepository } from './prices.js';
import {isFresh,type Card } from './domain.js';
export type MarketCard=Card&{value:number;capturedAt:Date;previous:number|null;previousAt:Date|null;change:number|null};
export function ratingValue(v:unknown,fallback=83){const n=Number(v??fallback);if(!Number.isInteger(n)||n<75||n>99)throw new Error('Rating must be a whole number from 75 to 99.');return n;}
export function targetValue(v:unknown){const n=Number(v);if(!Number.isInteger(n)||n<1||n>15000000)throw new Error('Price must be a whole coin amount from 1 to 15,000,000.');return n;}
export function fodderRows(cards:MarketCard[],rating?:number){const ratings=rating?[rating]:[83,84,85,86,87,88,89,90,91];return ratings.map(r=>({rating:r,cards:cards.filter(c=>c.rating===r).sort((a,b)=>a.value-b.value).slice(0,3)}));}
export function movers(cards:MarketCard[],direction='risers'){return cards.filter(c=>c.change!==null&&(direction==='fallers'?c.change<0:c.change>0)).sort((a,b)=>direction==='fallers'?a.change!-b.change!:b.change!-a.change!).slice(0,10);}
export class MarketService{
 private cached:{at:number;cards:MarketCard[]}|undefined;private pending:Promise<MarketCard[]>|undefined;
 constructor(public prices:PriceRepository,public platform:string,public maxAge=15){}
 async snapshot(){if(this.cached&&Date.now()-this.cached.at<300000)return this.cached.cards.filter(c=>isFresh(c.capturedAt,this.maxAge));if(this.pending)return this.pending;
 this.pending=this.load().then(cards=>{this.cached={at:Date.now(),cards};return cards;}).finally(()=>{this.pending=undefined;});return this.pending;}
 private async load():Promise<MarketCard[]>{
 const {rows}=await this.prices.pool.query(`WITH latest AS (
 SELECT DISTINCT ON(source_card_id) source_card_id,lowest_bin,captured_at
 FROM public.futgg_bin_history WHERE game_year=$1 AND platform=$2 AND lowest_bin>0
 AND captured_at>=now()-($3::int * interval '1 minute') AND captured_at<=now()+interval '1 minute'
 ORDER BY source_card_id,captured_at DESC,id DESC),baseline AS (
 SELECT DISTINCT ON(source_card_id) source_card_id,lowest_bin,captured_at
 FROM public.futgg_bin_history WHERE game_year=$1 AND platform=$2 AND lowest_bin>0
 AND captured_at BETWEEN now()-interval '25 hours' AND now()-interval '24 hours'
 ORDER BY source_card_id,captured_at DESC,id DESC)
 SELECT p.source_card_id::text AS id,COALESCE(p.display_name,p.name,p.full_name,'Unknown card') AS name,
 p.rating,p.primary_position AS position,p.rarity,p.club,COALESCE(p.card_image_stored_url,p.card_image_url,p.player_image_url) AS image,
 l.lowest_bin::int AS value,l.captured_at AS "capturedAt",b.lowest_bin::int AS previous,b.captured_at AS "previousAt"
 FROM latest l JOIN public.futgg_players p ON p.source_card_id=l.source_card_id AND p.game_year=$1
 LEFT JOIN baseline b ON b.source_card_id=l.source_card_id WHERE p.is_active=true`,[this.prices.year,this.platform,this.maxAge]);
 return rows.map(r=>({...r,value:Number(r.value),previous:r.previous===null?null:Number(r.previous),change:r.previous?((Number(r.value)-Number(r.previous))/Number(r.previous))*100:null}));
 }
}
