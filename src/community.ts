import type pg from 'pg';
import {discord,channelPermissions,HttpError} from './auth.js';
import {userBenefits,claimSeat,serverPlan,requireServerPlan,type Plan} from './plans.js';
import {Billing,catalogue,billingReady} from './billing.js';
import {validateFeed,nextRun,buildFeed,sharedEntries,type Feed} from './feeds.js';
import type {MarketService} from './market.js';
export async function membership(guild:string,user:string,fresh=false){try{return await discord(`/guilds/${guild}/members/${user}`,process.env.DISCORD_TOKEN!,'GET',undefined,false,fresh);}catch(e){if(e instanceof HttpError&&e.status===404)return null;throw e;}}
export const benefits=(pool:pg.Pool,user:string)=>userBenefits(pool,user,g=>membership(g,user));
export async function feedPermission(feed:Feed){
 const token=process.env.DISCORD_TOKEN!;
 const [guild,roles,channel,bot]=await Promise.all([discord('/guilds/'+feed.guild_id,token),discord(`/guilds/${feed.guild_id}/roles`,token),discord('/channels/'+feed.channel_id,token),discord('/users/@me',token)]);
 if(channel.guild_id!==feed.guild_id||![0,5].includes(channel.type))return false;
 const member=await discord(`/guilds/${feed.guild_id}/members/${bot.id}`,token);
 return channelPermissions(guild,roles,member,channel,(feed.kind==='fodder'||feed.kind==='consumables'))&&(!feed.role_id||roles.some((r:any)=>r.id===feed.role_id&&r.mentionable));
}
type Context={pool:pg.Pool;market:MarketService;billing:Billing;user:string;path:string;method:string;read:()=>Promise<any>;admin:(id:string)=>Promise<any>;memberGuilds:()=>Promise<any[]>;audit:(id:string,action:string,details?:unknown)=>Promise<void>};
export async function communityRoute(ctx:Context):Promise<any|undefined>{
 const {pool,market,billing,user,path,method,read,admin,memberGuilds,audit}=ctx;
 if(path==='/api/billing'&&method==='GET'){const own=(await pool.query("SELECT plan,status,paid_until,cancel_at_period_end FROM futbot_subscriptions WHERE scope='user' AND scope_id=$1",[user])).rows[0]??null;return {catalogue:catalogue(),ready:billingReady(),benefits:await benefits(pool,user),subscription:own};}
 if(path==='/api/billing/checkout'&&method==='POST'){const b=await read();if(!(b.plan in Object.fromEntries(catalogue().map(p=>[p.id,p]))))throw new Error('Unknown plan.');const scope=b.guild?'guild':'user',id=b.guild?String(b.guild):user;if(scope==='guild')await admin(id);return billing.checkout(user,scope,id,b.plan as Plan);}
 if(path==='/api/billing/portal'&&method==='POST'){const b=await read();if(b.guild)await admin(String(b.guild));return billing.portal(user,b.guild?'guild':'user',b.guild?String(b.guild):user);}
 if(path==='/api/communities'&&method==='GET')return {guilds:await memberGuilds()};
 const match=path.match(/^\/api\/communities\/(\d{17,20})\/(lists|cards|claim)$/);
 if(match){const [,id,action]=match;if(!await membership(id,user,method!=='GET'))throw new Error('You must be a member of this server.');
 if(action==='claim'&&method==='POST'){const m=await membership(id,user,true);await claimSeat(pool,id,user,m.roles);return {ok:true,benefits:await benefits(pool,user)};}
 await requireServerPlan(pool,id);
 if(action==='lists'&&method==='GET')return {lists:(await pool.query('SELECT id,name FROM futbot_shared_lists WHERE guild_id=$1 ORDER BY id',[id])).rows,plan:(await serverPlan(pool,id)).name};
 const b=await read();if(action==='cards'&&method==='POST'&&/^\d+$/.test(String(b.list)))return {cards:await sharedEntries(pool,String(b.list),id,market)};
 throw new Error('Unsupported community action.');
 }
 const adminMatch=path.match(/^\/api\/guilds\/(\d{17,20})\/(feeds|feed-preview|shared|seats|plan|roles)$/);if(!adminMatch)return;
 const [,id,action]=adminMatch;await admin(id);
 if(action==='plan'&&method==='GET'){const p=await serverPlan(pool,id),seats=(await pool.query('SELECT user_id,created_at FROM futbot_seats WHERE guild_id=$1 ORDER BY created_at',[id])).rows;return {...p,subscription:p.subscription?{plan:p.subscription.plan,status:p.subscription.status,paid_until:p.subscription.paid_until,cancel_at_period_end:p.subscription.cancel_at_period_end,purchaser:p.subscription.owner_id===user}:null,usedSeats:seats.length,seatLimit:p.seats,seats};}
 if(action==='roles'&&method==='GET'){const roles=await discord(`/guilds/${id}/roles`,process.env.DISCORD_TOKEN!);return {roles:roles.filter((r:any)=>r.id!==id&&!r.managed).map((r:any)=>({id:r.id,name:r.name,mentionable:r.mentionable}))};}
 if(action==='seats'&&method==='DELETE'){const b=await read();if(!/^\d{17,20}$/.test(String(b.user)))throw new Error('Choose a valid member.');await pool.query('DELETE FROM futbot_seats WHERE guild_id=$1 AND user_id=$2',[id,b.user]);await audit(id,'seat.released',{user:b.user});return {ok:true};}
 if(action==='feeds'&&method==='GET'){return {feeds:(await pool.query('SELECT * FROM futbot_feeds WHERE guild_id=$1 ORDER BY id',[id])).rows,runs:(await pool.query('SELECT r.*,f.name FROM futbot_feed_runs r JOIN futbot_feeds f ON f.id=r.feed_id WHERE f.guild_id=$1 ORDER BY r.id DESC LIMIT 30',[id])).rows};}
 if(action==='shared'&&method==='GET')return {lists:(await pool.query('SELECT l.id,l.name,count(c.card_id)::int AS cards FROM futbot_shared_lists l LEFT JOIN futbot_shared_cards c ON c.list_id=l.id WHERE l.guild_id=$1 GROUP BY l.id ORDER BY l.id',[id])).rows};
 const plan=await requireServerPlan(pool,id),b=await read();
 if(action==='feed-preview'&&method==='POST'){const f=validateFeed(b);const feed={...f,id:'preview',guild_id:id,last_prices:{},last_hash:null,next_run_at:new Date()} as Feed;await verifyList(pool,feed);const data=await buildFeed(pool,feed,market);return {payload:data.payload,cards:data.cards,hasImage:!!data.image,nextRun:nextRun(f.times,f.timezone)};}
 if(action==='feeds'){
 if(method==='DELETE'){await pool.query('DELETE FROM futbot_feeds WHERE id=$1 AND guild_id=$2',[numeric(b.id),id]);await audit(id,'feed.deleted');return {ok:true};}
 if(method!=='PUT'&&method!=='POST')throw new Error('Unsupported feed action.');
 const f=validateFeed(b),feed={...f,guild_id:id} as Feed;await verifyList(pool,feed);if(!await feedPermission(feed))throw new Error('Choose a channel with bot posting permissions and a mentionable role. Images require Attach Files.');
 const c=await pool.connect();try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['feeds:'+id]);
 if(!b.id){const n=(await c.query('SELECT count(*)::int AS n FROM futbot_feeds WHERE guild_id=$1',[id])).rows[0].n;if(n>=plan.feeds)throw new Error(`Your plan allows ${plan.feeds} feeds.`);}
 const values=[id,f.kind,f.name,f.channel_id,f.role_id,f.timezone,JSON.stringify(f.times),f.list_id,f.enabled,nextRun(f.times,f.timezone)];
 const r=b.id?await c.query('UPDATE futbot_feeds SET kind=$2,name=$3,channel_id=$4,role_id=$5,timezone=$6,times=$7,list_id=$8,enabled=$9,next_run_at=$10,updated_at=now(),last_hash=null WHERE guild_id=$1 AND id=$11 RETURNING id',[...values,numeric(b.id)]):await c.query('INSERT INTO futbot_feeds(guild_id,kind,name,channel_id,role_id,timezone,times,list_id,enabled,next_run_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id',values);
 if(!r.rowCount)throw new Error('Feed not found in this server.');await c.query('COMMIT');await audit(id,'feed.saved',{name:f.name,enabled:f.enabled});return {ok:true};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 }
 if(action==='shared'){
 const c=await pool.connect();try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['shared:'+id]);
 if(method==='POST'&&!b.list){const name=String(b.name??'').trim();if(!name||name.length>60)throw new Error('Use a list name up to 60 characters.');if((await c.query('SELECT count(*)::int AS n FROM futbot_shared_lists WHERE guild_id=$1',[id])).rows[0].n>=10)throw new Error('Maximum 10 shared lists.');await c.query('INSERT INTO futbot_shared_lists(guild_id,name,created_by) VALUES($1,$2,$3)',[id,name,user]);}
 else{const list=numeric(b.list);if(!(await c.query('SELECT 1 FROM futbot_shared_lists WHERE id=$1 AND guild_id=$2',[list,id])).rowCount)throw new Error('List not found in this server.');
 if(method==='DELETE'&&!b.card)await c.query('DELETE FROM futbot_shared_lists WHERE id=$1',[list]);
 else if(method==='DELETE')await c.query('DELETE FROM futbot_shared_cards WHERE list_id=$1 AND card_id=$2',[list,numeric(b.card)]);
 else if(method==='POST'){const card=await market.prices.card(numeric(b.card));if(!card)throw new Error('Card not found.');if((await c.query('SELECT count(*)::int AS n FROM futbot_shared_cards WHERE list_id=$1',[list])).rows[0].n>=25)throw new Error('Maximum 25 cards per shared list.');await c.query('INSERT INTO futbot_shared_cards(list_id,card_id,game_year,platform) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING',[list,card.id,market.prices.year,market.platform]);}else throw new Error('Unsupported list action.');}
 await c.query('COMMIT');await audit(id,'shared.updated');return {ok:true};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 }
 throw new Error('Unsupported server action.');
}
function numeric(v:unknown){const s=String(v??'');if(!/^\d+$/.test(s))throw new Error('Choose a valid record.');return s;}
async function verifyList(pool:pg.Pool,feed:Feed){if(feed.kind==='watchlist'&&!(await pool.query('SELECT 1 FROM futbot_shared_lists WHERE id=$1 AND guild_id=$2',[feed.list_id,feed.guild_id])).rowCount)throw new Error('Choose a watchlist owned by this server.');}
