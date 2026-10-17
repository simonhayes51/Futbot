import pg from 'pg';
import {logFailure} from './logging.js';
import type { Card, Price } from './domain.js';
export type MiscItemType='manager'|'manager_league'|'chemistry_style';
export type MiscMarketItem={item_type:MiscItemType;item_id:string;price:number|null;status:string;captured_at:Date;price_updated_at:Date|null;last_checked_at:Date|null;baseline_price?:number|null};
export const isMiscItemType=(value:unknown):value is MiscItemType=>value==='manager'||value==='manager_league'||value==='chemistry_style';
export function miscItemLabel(itemType:MiscItemType,itemId:string){const label=itemType==='manager'?'Manager':itemType==='manager_league'?'Manager league':'Chemistry style';return `${label} #${itemId}`;}
export class PriceRepository {
  pool: pg.Pool;
  private reads=new Map<string,{until:number;value:Promise<any>}>();
  private cached<T>(key:string,ms:number,load:()=>Promise<T>):Promise<T>{
    const hit=this.reads.get(key);if(hit&&hit.until>Date.now())return hit.value;
    const value=load().catch(e=>{this.reads.delete(key);throw e;});this.reads.set(key,{until:Date.now()+ms,value});
    if(this.reads.size>1500){for(const [k,v]of this.reads)if(v.until<Date.now())this.reads.delete(k);if(this.reads.size>2000)this.reads.delete(this.reads.keys().next().value!);}
    return value;
  }
  constructor(url: string, public year = 27) {
    this.pool = new pg.Pool({ connectionString: url, max: 4, statement_timeout: 8000, connectionTimeoutMillis:10000, idleTimeoutMillis:30000, keepAlive:true,
      options: '-c default_transaction_read_only=on', application_name: 'futbot-price-reader' });
    this.pool.on('error',error=>logFailure('Price database idle connection error',error));
  }
  private historyTable(platform: string) {
    if (platform === 'pc') return 'public.futbot_pc_bin_history';
    if (platform === 'ps5') return 'public.futgg_bin_history';
    throw new Error('Unsupported price platform. Choose PS5 or PC.');
  }
  async cardTypes():Promise<string[]>{return this.cached('card-types:'+this.year,600000,async()=>(await this.pool.query(`SELECT DISTINCT rarity FROM public.futgg_players WHERE game_year=$1 AND is_active=true AND rarity IS NOT NULL ORDER BY rarity`,[this.year])).rows.map(r=>String(r.rarity)));}
  async search(query: string,filters:{rarity?:string;rating?:number;position?:string}={}): Promise<Card[]> {
    const term = query.replace(/[\\%_]/g, '\\$&').slice(0, 80);
    const { rows } = await this.pool.query(`SELECT source_card_id::text AS id,
      COALESCE(display_name,name,full_name,'Unknown card') AS name, rating,
      primary_position AS position, rarity, club, league,
      COALESCE(card_image_stored_url,card_image_url,player_image_url) AS image
      FROM public.futgg_players WHERE game_year=$1 AND is_active=true
      AND (COALESCE(name,'') ILIKE $2 OR COALESCE(display_name,'') ILIKE $2 OR source_card_id::text=$3)
      AND ($4::text IS NULL OR rarity=$4)
      AND ($5::int IS NULL OR rating=$5)
      AND ($6::text IS NULL OR primary_position=$6)
      ORDER BY rating DESC NULLS LAST,source_card_id LIMIT 100`, [this.year, `%${term}%`, query, filters.rarity||null, filters.rating||null, filters.position||null]);
    return rows;
  }
  async card(id: string): Promise<Card | null> {
    return this.cached('card:'+id,300000,async()=>{
    const { rows } = await this.pool.query(`SELECT source_card_id::text AS id,
      COALESCE(display_name,name,full_name,'Unknown card') AS name,rating,primary_position AS position,rarity,club,league,
      COALESCE(card_image_stored_url,card_image_url,player_image_url) AS image
      FROM public.futgg_players WHERE source_card_id=$1 AND game_year=$2`, [id,this.year]);
    return rows[0] || null;});
  }
  async latest(cardId: string, platform: string): Promise<Price | null> {
    const table=this.historyTable(platform);
    return this.cached('latest:'+platform+':'+cardId,30000,async()=>{
    const { rows } = await this.pool.query(`SELECT source_card_id::text AS "cardId",platform,
      lowest_bin AS value,captured_at AS "capturedAt" FROM ${table}
      WHERE source_card_id=$1 AND platform=$2 AND game_year=$3 AND lowest_bin>0
      ORDER BY captured_at DESC,id DESC LIMIT 1`, [cardId,platform,this.year]);
    return rows[0]?{...rows[0],value:Number(rows[0].value)}:null;});
  }
  async baseline(cardId:string,platform:string):Promise<{value:number;capturedAt:Date}|null>{
    const table=this.historyTable(platform);
    return this.cached('baseline:'+platform+':'+cardId,300000,async()=>{const {rows}=await this.pool.query(`SELECT percentile_cont(0.5) WITHIN GROUP(ORDER BY lowest_bin)::int AS value,max(captured_at) AS "capturedAt" FROM ${table} WHERE source_card_id=$1 AND platform=$2 AND game_year=$3 AND lowest_bin>0 AND captured_at BETWEEN now()-interval '25 hours' AND now()-interval '24 hours' HAVING count(*)>=3`,[cardId,platform,this.year]);return rows[0]??null;});
  }
  async history(cardId: string, platform: string, hours = 24): Promise<{ at: Date; value: number }[]> {
    const table=this.historyTable(platform);
    return this.cached('history:'+platform+':'+cardId+':'+hours,300000,async()=>{const { rows } = await this.pool.query(`SELECT date_trunc('hour',captured_at) AS at,
      percentile_cont(0.5) WITHIN GROUP (ORDER BY lowest_bin)::int AS value
      FROM ${table} WHERE source_card_id=$1 AND platform=$2 AND game_year=$3
      AND captured_at>=now()-($4::int * interval '1 hour') AND lowest_bin>0
      GROUP BY 1 ORDER BY 1`,[cardId,platform,this.year,Math.min(hours,168)]);
    return rows;});
  }
  async fodderIndex(platform:string,rating:number,maxAgeMinutes=15):Promise<{value:number;capturedAt:Date}|null>{
    const table=this.historyTable(platform);
    const {rows}=await this.pool.query(`SELECT percentile_cont(0.5) WITHIN GROUP(ORDER BY v)::int AS value,max(at) AS "capturedAt" FROM (
      SELECT l.lowest_bin::int AS v,l.captured_at AS at FROM public.futgg_players p JOIN LATERAL (
        SELECT h.lowest_bin,h.captured_at FROM ${table} h WHERE h.source_card_id=p.source_card_id AND h.game_year=$1 AND h.platform=$2 AND h.lowest_bin>0 AND h.captured_at>=now()-($4::int*interval '1 minute') ORDER BY h.captured_at DESC,h.id DESC LIMIT 1
      ) l ON true WHERE p.game_year=$1 AND p.is_active=true AND p.rating=$3 AND p.primary_position IS NOT NULL AND COALESCE(p.display_name,p.name,p.full_name,'Unknown card') NOT ILIKE 'unknown%' ORDER BY l.lowest_bin LIMIT 3
    ) cheapest HAVING count(*)=3`,[this.year,platform,rating,maxAgeMinutes]);
    return rows[0]?.value===null?null:rows[0]?.value?{value:Number(rows[0].value),capturedAt:rows[0].capturedAt}:null;
  }
  async miscItems(platform:string):Promise<MiscMarketItem[]>{
    if(!['ps5','pc'].includes(platform))throw new Error('Unsupported price platform. Choose PS5 or PC.');
    return this.cached('misc-items:'+platform,30000,async()=>{
      const {rows}=await this.pool.query(`WITH latest AS (
        SELECT DISTINCT ON (item_type,item_id)
          item_type,item_id,price,status,captured_at,price_updated_at,last_checked_at
        FROM public.futgg_misc_price_history
        WHERE game_year=$1 AND platform=$2
        ORDER BY item_type,item_id,captured_at DESC,id DESC
      ), baseline AS (
        SELECT item_type,item_id,
          percentile_cont(0.5) WITHIN GROUP (ORDER BY price)::int AS baseline_price
        FROM public.futgg_misc_price_history
        WHERE game_year=$1 AND platform=$2 AND price>0
          AND captured_at BETWEEN now()-interval '25 hours' AND now()-interval '24 hours'
        GROUP BY item_type,item_id HAVING count(*)>=1
      )
      SELECT l.item_type,l.item_id::text,l.price,l.status,l.captured_at,
        l.price_updated_at,l.last_checked_at,b.baseline_price
      FROM latest l LEFT JOIN baseline b USING(item_type,item_id)
      ORDER BY l.item_type,l.item_id`,[this.year,platform]);
      return rows.map(r=>({...r,item_id:String(r.item_id),price:r.price===null?null:Number(r.price),baseline_price:r.baseline_price===null?null:Number(r.baseline_price)}));
    });
  }
  async miscLatest(itemType:MiscItemType,itemId:string,platform:string):Promise<MiscMarketItem|null>{
    if(!isMiscItemType(itemType)||!/^\d+$/.test(itemId)||!['ps5','pc'].includes(platform))throw new Error('Choose a valid consumable and market.');
    return this.cached('misc-latest:'+platform+':'+itemType+':'+itemId,30000,async()=>{
      const {rows}=await this.pool.query(`SELECT item_type,item_id::text,price,status,captured_at,
        price_updated_at,last_checked_at
        FROM public.futgg_misc_price_history
        WHERE game_year=$1 AND platform=$2 AND item_type=$3 AND item_id=$4
        ORDER BY captured_at DESC,id DESC LIMIT 1`,[this.year,platform,itemType,itemId]);
      const row=rows[0];return row?{...row,item_id:String(row.item_id),price:row.price===null?null:Number(row.price)}:null;
    });
  }
  async miscHistory(itemType:MiscItemType,itemId:string,platform:string,hours=24):Promise<{at:Date;value:number}[]>{
    if(!isMiscItemType(itemType)||!/^\d+$/.test(itemId)||!['ps5','pc'].includes(platform))throw new Error('Choose a valid consumable and market.');
    const span=Math.max(1,Math.min(hours,168));
    return this.cached('misc-history:'+platform+':'+itemType+':'+itemId+':'+span,120000,async()=>{
      const {rows}=await this.pool.query(`SELECT date_trunc('hour',captured_at) AS at,
        percentile_cont(0.5) WITHIN GROUP(ORDER BY price)::int AS value
        FROM public.futgg_misc_price_history
        WHERE game_year=$1 AND platform=$2 AND item_type=$3 AND item_id=$4
          AND price>0 AND captured_at>=now()-($5::int*interval '1 hour')
        GROUP BY 1 ORDER BY 1`,[this.year,platform,itemType,itemId,span]);
      return rows.map(r=>({...r,value:Number(r.value)}));
    });
  }
}
