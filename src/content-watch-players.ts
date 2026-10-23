import type pg from 'pg';
import type {Player} from './content-watch.js';

const number=(v:unknown):number|undefined=>typeof v==='number'&&Number.isFinite(v)?v:undefined;
const object=(v:unknown):Record<string,any>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,any>:{};
// Never use a base player's metadata to certify a different special/EVO item.
// Only explicit complete positions / PlayStyle counts from this exact row qualify.
export function playerFromRow(row:Record<string,any>,year:number,platform:string):Player{
 const raw=object(row.raw_data),stats=object(row.stats),positions=row.positions??row.possible_positions??raw.possiblePositions;
 const aliases:Record<string,string[]>={PACE:['facePace','pace'],SHOOTING:['faceShooting','shooting'],PASSING:['facePassing','passing'],DRIBBLING_MAIN:['faceDribbling','dribbling'],DEFENSE:['faceDefending','defending'],PHYSICALITY:['facePhysicality','physicality']};
 const mapped:Record<string,number>={};for(const [attribute,keys] of Object.entries(aliases))for(const k of keys){const n=number(row[k]??stats[k]??raw[k]);if(n!==undefined){mapped[attribute]=n;break;}}
 return {id:String(row.source_card_id),name:String(row.display_name??row.name??row.full_name??'Unknown card'),gameYear:year,platform,rating:number(row.rating),
  positions:Array.isArray(positions)&&positions.every(p=>typeof p==='string')?positions:undefined,stats:mapped,
  basePlayStyles:number(row.base_playstyles_count??raw.basePlayStylesCount),plusPlayStyles:number(row.plus_playstyles_count??raw.plusPlayStylesCount),
  rarityId:number(row.rarity_ea_id??raw.rarityEaId),nationId:number(row.nation_source_id),leagueId:number(row.league_source_id),definitionId:number(raw.resourceId),
  skills:number(row.skill_moves??raw.skillMoves),weakFoot:number(row.weak_foot??raw.weakFoot),price:number(row.content_price),
  priceCheckedAt:row.content_price_at instanceof Date?row.content_price_at.toISOString():typeof row.content_price_at==='string'?row.content_price_at:undefined};
}
export async function readMarketPlayers(pool:Pick<pg.Pool,'query'>,year:number,platform:string,maxAge:number):Promise<Player[]>{
 const table=platform==='ps5'?'public.futgg_bin_history':platform==='pc'?'public.futbot_pc_bin_history':null;if(!table)throw new Error('Unsupported market');
 const result=await pool.query(`SELECT to_jsonb(p) AS card,h.lowest_bin::int AS content_price,h.captured_at AS content_price_at
 FROM public.futgg_players p LEFT JOIN LATERAL (
  SELECT lowest_bin,captured_at FROM ${table} WHERE source_card_id=p.source_card_id AND game_year=$1 AND platform=$2
  AND lowest_bin>0 AND captured_at>=now()-($3::int*interval '1 minute') ORDER BY captured_at DESC,id DESC LIMIT 1
 ) h ON true WHERE p.game_year=$1 AND p.is_active=true ORDER BY p.source_card_id LIMIT 30001`,[year,platform,Math.ceil(maxAge)]);
 if(result.rows.length>30000)throw new Error('Player feed exceeds 30,000 cards; supply a scoped enriched player file');
 return result.rows.map(r=>playerFromRow({...r.card,content_price:r.content_price,content_price_at:r.content_price_at},year,platform));
}
