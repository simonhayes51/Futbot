import type pg from 'pg';
export type GuildSettings={name:string;accent:string;footer:string;settings:{fodderChannel?:string}};
export const defaultBrand:GuildSettings={name:'FutBot',accent:'#3458ff',footer:'Ultimate Team market tools',settings:{}};
export function validateBrand(body:any):GuildSettings{
 const name=String(body.name??'').trim(),footer=String(body.footer??'').trim(),accent=String(body.accent??'');
 if(!name||name.length>50||footer.length>120||!/^#[0-9a-f]{6}$/i.test(accent))throw new Error('Use a name up to 50 characters, footer up to 120 and a valid hex colour.');
 const fodderChannel=String(body.settings?.fodderChannel??'');if(fodderChannel&&!/^\d{17,20}$/.test(fodderChannel))throw new Error('Choose a valid Discord channel.');
 return {name,accent,footer,settings:{fodderChannel}};
}
export async function guildSettings(pool:pg.Pool,id?:string|null):Promise<GuildSettings>{if(!id)return {...defaultBrand};const {rows}=await pool.query('SELECT name,accent,footer,settings FROM futbot_guilds WHERE guild_id=$1',[id]);const b=rows[0];return b?{...b,accent:b.accent==='#b7f67b'?'#3458ff':b.accent}:defaultBrand;}
export async function saveBrand(pool:pg.Pool,id:string,brand:GuildSettings){await pool.query(`INSERT INTO futbot_guilds(guild_id,name,accent,footer,settings) VALUES($1,$2,$3,$4,$5) ON CONFLICT(guild_id) DO UPDATE SET name=EXCLUDED.name,accent=EXCLUDED.accent,footer=EXCLUDED.footer,settings=EXCLUDED.settings`,[id,brand.name,brand.accent,brand.footer,brand.settings]);}
export async function watch(pool:pg.Pool,userId:string,cardId:string,year:number,platform:string){const c=await pool.connect();try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[userId]);const n=await c.query('SELECT count(*)::int AS n FROM futbot_watchlist WHERE user_id=$1',[userId]);if(n.rows[0].n>=100)throw new Error('Your watchlist is full (100 cards).');await c.query('INSERT INTO futbot_watchlist(user_id,card_id,game_year,platform) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[userId,cardId,year,platform]);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
export async function watched(pool:pg.Pool,userId:string,year:number,platform:string){return (await pool.query('SELECT card_id::text AS id FROM futbot_watchlist WHERE user_id=$1 AND game_year=$2 AND platform=$3 ORDER BY created_at DESC LIMIT 100',[userId,year,platform])).rows.map(r=>r.id as string);}
