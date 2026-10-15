import type pg from 'pg';
export const plans={
 free:{name:'Free',price:0,alerts:3,watch:20,feeds:0,seats:0},
 personal:{name:'Personal Pro',price:3.99,alerts:25,watch:100,feeds:0,seats:0},
 tools:{name:'Server Tools',price:7.99,alerts:3,watch:20,feeds:4,seats:0},
 complete25:{name:'Complete 25',price:19.99,alerts:25,watch:100,feeds:8,seats:25},
 complete100:{name:'Complete 100',price:49.99,alerts:25,watch:100,feeds:8,seats:100},
 complete250:{name:'Complete 250',price:99.99,alerts:25,watch:100,feeds:8,seats:250}
} as const;
export type Plan=keyof typeof plans;
export function paid(row:any,now=Date.now()){return !!row&&['active','trialing'].includes(row.status)&&new Date(row.paid_until).getTime()>now;}
export async function serverPlan(pool:pg.Pool,id:string){const row=(await pool.query("SELECT * FROM futbot_subscriptions WHERE scope='guild' AND scope_id=$1",[id])).rows[0];const beta=(process.env.FUTBOT_BETA_GUILD_IDS??'').split(',').map(v=>v.trim()).includes(id)&&new Date(process.env.FUTBOT_BETA_UNTIL??'').getTime()>Date.now();const key:Plan=beta?'complete25':paid(row)&&Object.hasOwn(plans,row.plan)?row.plan:'free';return {key,...plans[key],beta,subscription:row??null};}
export async function userBenefits(pool:pg.Pool,id:string,member:(guild:string)=>Promise<{roles:string[]}|null>){
 const own=(await pool.query("SELECT * FROM futbot_subscriptions WHERE scope='user' AND scope_id=$1",[id])).rows[0];
 if(paid(own)&&own.plan==='personal')return {plan:'personal',source:'Your Personal Pro subscription',alerts:25,watch:100};
 const seats=(await pool.query("SELECT s.guild_id,g.settings FROM futbot_seats s LEFT JOIN futbot_guilds g ON g.guild_id=s.guild_id WHERE s.user_id=$1 ORDER BY s.created_at LIMIT 50",[id])).rows;
 for(const seat of seats){const plan=await serverPlan(pool,seat.guild_id);if(!plan.seats)continue;const rank=(await pool.query('SELECT user_id FROM futbot_seats WHERE guild_id=$1 ORDER BY created_at,user_id LIMIT $2',[seat.guild_id,plan.seats])).rows;if(!rank.some(r=>r.user_id===id))continue;const m=await member(seat.guild_id);const roles=seat.settings?.accessRoleIds??[];if(m&&(!roles.length||roles.some((r:string)=>m.roles.includes(r))))return {plan:plan.key,source:'Included by your server',guildId:seat.guild_id,alerts:25,watch:100};}
 return {plan:'free',source:'Free account',alerts:Number(process.env.FREE_ALERT_LIMIT||3),watch:20};
}
export async function claimSeat(pool:pg.Pool,guild:string,user:string,roles:string[]){
 const own=(await pool.query("SELECT * FROM futbot_subscriptions WHERE scope='user' AND scope_id=$1",[user])).rows[0];if(paid(own)&&own.plan==='personal')throw new Error('You already have Personal Pro. Manage your individual billing before claiming a server seat.');
 const c=await pool.connect();try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['seats:'+guild]);
 const plan=await serverPlan(c as any,guild);if(!plan.seats)throw new Error('This server does not include member Pro seats.');
 const settings=(await c.query('SELECT settings FROM futbot_guilds WHERE guild_id=$1',[guild])).rows[0]?.settings;const allowed=settings?.accessRoleIds??[];
 if(allowed.length&&!allowed.some((r:string)=>roles.includes(r)))throw new Error('Your server requires a selected role for its Pro seats.');
 const exists=await c.query('SELECT 1 FROM futbot_seats WHERE guild_id=$1 AND user_id=$2',[guild,user]);
 if(!exists.rowCount){const count=(await c.query('SELECT count(*)::int AS n FROM futbot_seats WHERE guild_id=$1',[guild])).rows[0].n;if(count>=plan.seats)throw new Error('All server Pro seats are in use. Ask an admin to release one.');await c.query('INSERT INTO futbot_seats(guild_id,user_id) VALUES($1,$2)',[guild,user]);}
 await c.query('COMMIT');return plan;
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
export async function requireServerPlan(pool:pg.Pool,id:string){const p=await serverPlan(pool,id);if(!p.feeds)throw new Error('Server Tools or Complete is required. Open Plans & billing to upgrade.');return p;}
