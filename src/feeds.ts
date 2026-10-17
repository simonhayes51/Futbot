import type pg from 'pg';
import {createHash} from 'node:crypto';
import {EmbedBuilder,ActionRowBuilder,StringSelectMenuBuilder,ButtonBuilder,ButtonStyle} from 'discord.js';
import {fodderRows,movers,type MarketCard,type MarketService} from './market.js';
import {guildSettings,type GuildSettings} from './settings.js';
import {requireServerPlan} from './plans.js';
import {coins,isFresh} from './domain.js';
import {fodderBoard,consumablesBoard,rankConsumables} from './boards.js';
import type {MiscMarketItem} from './prices.js';
import {logFailure} from './logging.js';
export type FeedKind='fodder'|'movers'|'watchlist'|'summary'|'consumables';
export type Feed={id:string;guild_id:string;kind:FeedKind;name:string;channel_id:string;role_id:string|null;timezone:string;times:string[];list_id:string|null;enabled:boolean;next_run_at:Date;last_hash:string|null;last_prices:Record<string,number>};
export function validateFeed(b:any){
 const name=String(b.name??'').trim(),channel_id=String(b.channel_id??''),role_id=String(b.role_id??'')||null,timezone=String(b.timezone??'Europe/London'),times:string[]=Array.isArray(b.times)?[...new Set<string>(b.times.map(String))].sort():[];
 if(!name||name.length>60||!['fodder','movers','watchlist','summary','consumables'].includes(b.kind)||!/^\d{17,20}$/.test(channel_id)||role_id&&!/^\d{17,20}$/.test(role_id))throw new Error('Choose a feed type, name, channel and valid optional role.');
 if(!times.length||times.length>6||times.some(t=>!/^([01]\d|2[0-3]):[0-5]\d$/.test(t)))throw new Error('Choose 1–6 daily posting times in HH:MM format.');
 try{new Intl.DateTimeFormat('en-GB',{timeZone:timezone}).format();}catch{throw new Error('Choose a valid timezone, such as Europe/London.');}
 const list_id=b.kind==='watchlist'?String(b.list_id??''):null;if(list_id!==null&&!/^\d+$/.test(list_id))throw new Error('Choose a shared watchlist for this feed.');
 return {name,channel_id,role_id,timezone,times,list_id,kind:b.kind as FeedKind,enabled:b.enabled===true};
}
export function nextRun(times:string[],timezone:string,after=new Date()){
 const format=new Intl.DateTimeFormat('en-GB',{timeZone:timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
 for(let t=Math.floor(after.getTime()/60000)*60000+60000,end=t+49*3600000;t<end;t+=60000)if(times.includes(format.format(t)))return new Date(t);
 throw new Error('Could not calculate the next posting time.');
}
export async function sharedEntries(pool:pg.Pool,list:string,guild:string,market:MarketService){
 const ids=(await pool.query('SELECT c.card_id::text AS id FROM futbot_shared_cards c JOIN futbot_shared_lists l ON l.id=c.list_id WHERE l.id=$1 AND l.guild_id=$2 AND c.game_year=$3 AND c.platform=$4 ORDER BY c.created_at LIMIT 25',[list,guild,market.prices.year,market.platform])).rows.map(r=>r.id);
 if(!ids.length)return [];
 const data=await Promise.all(ids.map(async id=>{const [card,p,b]=await Promise.all([market.prices.card(id),market.prices.latest(id,market.platform),market.prices.baseline(id,market.platform)]);const fresh=!!p&&isFresh(p.capturedAt,market.maxAge);return card?{...card,value:fresh?Number(p!.value):null,capturedAt:p?.capturedAt??null,stale:!fresh,previous:b?.value??null,previousAt:b?.capturedAt??null,change:fresh&&b?.value?(Number(p!.value)-b.value)/b.value*100:null}:{id,name:'Unavailable card #'+id,rating:null,position:null,rarity:null,club:null,image:null,value:null,capturedAt:null,stale:true,previous:null,previousAt:null,change:null};}));return data;
}
export async function sharedCards(pool:pg.Pool,list:string,guild:string,market:MarketService):Promise<MarketCard[]>{return (await sharedEntries(pool,list,guild,market)).filter(c=>!c.stale) as MarketCard[];}
export function feedCards(kind:FeedKind,cards:MarketCard[]){if(kind==='consumables')return [];return kind==='fodder'?fodderRows(cards).flatMap(r=>r.cards.slice(0,1)):kind==='movers'?[...movers(cards).slice(0,3),...movers(cards,'fallers').slice(0,3)]:kind==='summary'?[...fodderRows(cards).filter(r=>[85,88,90].includes(r.rating)).flatMap(r=>r.cards.slice(0,1)),...movers(cards).slice(0,2),...movers(cards,'fallers').slice(0,2)]:cards.slice(0,25);}
export function fingerprint(cards:Array<{id:string;value:number|null}>){return createHash('sha256').update(JSON.stringify(cards.map(c=>[c.id,c.value]))).digest('hex');}
export function feedPayload(feed:Pick<Feed,'kind'|'name'|'role_id'|'last_prices'>,cards:MarketCard[],brand:GuildSettings,platform:string,year:number){
 const title={fodder:'🧱 FODDER WATCH',movers:'📈 THE MARKET MOVES',watchlist:'⭐ THE SERVER WATCHLIST',summary:'🗞 THE MARKET BRIEF',consumables:'🧴 CONSUMABLE MARKET WATCH'}[feed.kind];
 const embed=new EmbedBuilder().setAuthor({name:brand.name}).setColor(brand.accent as `#${string}`).setTitle(title).setDescription(`**${feed.name}**\nFresh observed BINs · ${platform.toUpperCase()} · FC${year}\nChanges below compare with the previous successful post.`).setFooter({text:brand.footer+' • Observed prices, check in-game'}).setTimestamp();
 for(const c of cards.slice(0,9)){const previous=feed.last_prices[c.id],delta=previous?c.value-previous:null;embed.addFields({name:`${c.rating??'—'} ${c.position??''} · ${c.name}`.slice(0,256),value:`🪙 **${coins(c.value)}**${delta!==null?`\n${delta>=0?'↗ +':'↘ '}${coins(delta)} since last post`:c.change!==null?`\n${c.change>=0?'+':''}${c.change.toFixed(1)}% / ~24h`:'\nFirst observation'}`,inline:true});}
 if(cards[0]?.image?.startsWith('https://'))embed.setThumbnail(cards[0].image);
 const components:any[]=[];if(cards.length)components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId('feedcard').setPlaceholder('View a card · set an alert · watch it').addOptions(cards.slice(0,25).map(c=>({label:`${c.name} · ${c.rating??'?'} ${c.position??''}`.slice(0,100),description:`${coins(c.value)} coins · ${c.rarity??'Player item'}`.slice(0,100),value:c.id})))));
 if(process.env.PUBLIC_URL)components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Open your control room').setURL(new URL('/app/',process.env.PUBLIC_URL).href)));
 return {content:feed.role_id?`<@&${feed.role_id}>`:undefined,embeds:[embed.toJSON()],components:components.map(c=>c.toJSON()),allowed_mentions:{parse:[],roles:feed.role_id?[feed.role_id]:[]}};
}
function consumablesFeedPayload(feed:Pick<Feed,'name'|'role_id'>,items:MiscMarketItem[],brand:GuildSettings,platform:string,year:number){
 const rises=rankConsumables(items,'risers',5),falls=rankConsumables(items,'fallers',5);
 const lines=(rows:typeof rises,empty:string)=>rows.length?rows.map((item,index)=>`**${index+1}. ${item.display_name||item.item_type.replaceAll('_',' ')}** · ${coins(Number(item.price))} · ${item.change_pct>0?'+':''}${item.change_pct.toFixed(1)}%`).join('\n'):`No qualifying moves. ${empty}`;
 const embed=new EmbedBuilder().setAuthor({name:brand.name}).setColor(brand.accent as `#${string}`).setTitle('🧴 CONSUMABLE MARKET WATCH')
  .setDescription(`**${feed.name}**\nFresh observed prices · ${platform.toUpperCase()} · FC${year}`)
  .addFields({name:'📈 TOP RISERS',value:lines(rises,'No valid 24-hour baselines yet.'),inline:true},{name:'📉 TOP DROPS',value:lines(falls,'No valid 24-hour baselines yet.'),inline:true})
  .setFooter({text:brand.footer+' • Lowest observed BIN, not sales volume • Check in-game'}).setTimestamp();
 const ranked=rankConsumables(items,'all',12);
 const choices=ranked.length?ranked:[...items].sort((a,b)=>Number(a.price)-Number(b.price)).slice(0,12).map(item=>({...item,change_pct:0}));
 const components:any[]=[];
 if(choices.length)components.push(new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(new StringSelectMenuBuilder().setCustomId('miscfeeditem').setPlaceholder('Open an item · chart, watch or alert').addOptions(choices.map(item=>({label:(item.display_name||item.item_type.replaceAll('_',' ')+' #'+item.item_id).slice(0,100),description:`${coins(Number(item.price))} coins · ${item.item_type.replaceAll('_',' ')}`.slice(0,100),value:`${item.item_type}:${item.item_id}:${platform}`})))));
 if(process.env.PUBLIC_URL)components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel('Open your control room').setURL(new URL('/app/',process.env.PUBLIC_URL).href)));
 return {content:feed.role_id?`<@&${feed.role_id}>`:undefined,embeds:[embed.toJSON()],components:components.map(c=>c.toJSON()),allowed_mentions:{parse:[],roles:feed.role_id?[feed.role_id]:[]}};
}
export async function buildFeed(pool:pg.Pool,feed:Feed,market:MarketService){
 if(feed.kind==='consumables'){
  const [raw,catalog]=await Promise.all([
   market.prices.miscItems(market.platform),
   pool.query('SELECT item_type,item_id::text,display_name FROM futbot_misc_item_catalog WHERE game_year=$1',[market.prices.year])
  ]);
  const names=new Map(catalog.rows.map(row=>[`${row.item_type}:${row.item_id}`,row.display_name]));
  const items=raw.filter(item=>item.price!==null&&Number(item.price)>0&&isFresh(item.last_checked_at??item.captured_at,market.maxAge))
   .map(item=>({...item,display_name:item.display_name||names.get(`${item.item_type}:${item.item_id}`)||null}));
  if(!items.length)throw new Error('Waiting for fresh consumable prices.');
  const brand=await guildSettings(pool,feed.guild_id),rises=rankConsumables(items,'risers',5),falls=rankConsumables(items,'fallers',5);
  const top=rises.length||falls.length?[...rises,...falls]:[...items].sort((a,b)=>Number(a.price)-Number(b.price)).slice(0,12);
  const cards=top.map(item=>({id:`${item.item_type}:${item.item_id}`,value:Number(item.price)}));
  const payload=consumablesFeedPayload(feed,items,brand,market.platform,market.prices.year);
  return {cards,payload,hash:fingerprint(cards),image:await consumablesBoard(items,market.platform,market.prices.year,brand),filename:'consumables.png'};
 }
 const raw=feed.kind==='watchlist'?await sharedCards(pool,feed.list_id!,feed.guild_id,market):await market.snapshot();
 const cards=feedCards(feed.kind,raw).filter(c=>isFresh(c.capturedAt,market.maxAge));
 // Avoid a partial collector run becoming a nearly empty fodder/summary board.
 if(!cards.length||feed.kind==='fodder'&&cards.length<9||feed.kind==='summary'&&cards.length<3)throw new Error('Waiting for a complete, fresh set of prices.');
 const brand=await guildSettings(pool,feed.guild_id),payload=feedPayload(feed,cards,brand,market.platform,market.prices.year);
 return {cards,payload,hash:fingerprint(cards),image:feed.kind==='fodder'?await fodderBoard(raw,undefined,market.prices.year,brand):null,filename:feed.kind==='fodder'?'fodder.png':undefined};
}
export class FeedDeliveryError extends Error{constructor(message:string,public uncertain=false){super(message);}}
export async function sendFeed(channel:string,payload:any,image:Buffer|null,nonce:string,token:string,filename='fodder.png'){
 let body:BodyInit;const headers:Record<string,string>={Authorization:'Bot '+token};const message={...payload,nonce,enforce_nonce:true};
 if(image){message.embeds[0].image={url:'attachment://'+filename};const form=new FormData();form.set('payload_json',JSON.stringify({...message,attachments:[{id:0,filename}]}));form.set('files[0]',new Blob([new Uint8Array(image)],{type:'image/png'}),filename);body=form;}else{headers['Content-Type']='application/json';body=JSON.stringify(message);}
 const response=await fetch('https://discord.com/api/v10/channels/'+channel+'/messages',{method:'POST',headers,body,signal:AbortSignal.timeout(20000)});
 if(!response.ok)throw new FeedDeliveryError(response.status===403?'Discord permissions changed. Check View Channel, Send Messages, Embed Links and Attach Files.':response.status===429?'Discord rate limited this post. It will not be retried automatically.':'Discord rejected the post.');return response.json() as Promise<{id:string}>;
}
export async function feedTick(pool:pg.Pool,market:MarketService,token:string,canPost:(feed:Feed)=>Promise<boolean>){
 const due=(await pool.query<Feed>('SELECT * FROM futbot_feeds WHERE enabled AND next_run_at<=now() ORDER BY next_run_at LIMIT 20')).rows;
 for(const candidate of due){const c=await pool.connect();try{
 const lock=await c.query('SELECT pg_try_advisory_lock(hashtext($1)) AS locked',['feed:'+candidate.id]);if(!lock.rows[0].locked)continue;
 const feed=(await c.query<Feed>('SELECT * FROM futbot_feeds WHERE id=$1 AND enabled AND next_run_at<=now()',[candidate.id])).rows[0];if(!feed)continue;
 const next=nextRun(feed.times,feed.timezone),slot=feed.next_run_at;
 // Persist the claim before any network send. A process crash never blindly replays a post.
 const claim=await c.query("INSERT INTO futbot_feed_runs(feed_id,slot,state) VALUES($1,$2,'sending') ON CONFLICT DO NOTHING RETURNING id",[feed.id,slot]);
 await c.query('UPDATE futbot_feeds SET next_run_at=$2 WHERE id=$1',[feed.id,next]);if(!claim.rowCount)continue;const run=claim.rows[0].id;
 let sending=false,sent=false;
 try{const plan=await requireServerPlan(pool,feed.guild_id);const eligible=(await pool.query('SELECT id FROM futbot_feeds WHERE guild_id=$1 ORDER BY id LIMIT $2',[feed.guild_id,plan.feeds])).rows;if(!eligible.some(r=>String(r.id)===String(feed.id)))throw new Error('This feed exceeds the current plan allowance. Delete unused feeds or upgrade.');if(Date.now()-new Date(slot).getTime()>15*60000)throw new Error('Missed time slot skipped; no backlog will be posted.');
 const data=await buildFeed(pool,feed,market);if(data.hash===feed.last_hash){await c.query("UPDATE futbot_feed_runs SET state='skipped',detail='Prices unchanged since the previous post.' WHERE id=$1",[run]);continue;}
 if(!await canPost(feed))throw new Error('Channel or role permissions no longer allow this post.');
 sending=true;const message=await sendFeed(feed.channel_id,data.payload,data.image,'fbr'+run,token,data.filename);sending=false;sent=true;
 await c.query('BEGIN');await c.query("UPDATE futbot_feed_runs SET state='posted',message_id=$2,detail='Published successfully.' WHERE id=$1",[run,message.id]);await c.query('UPDATE futbot_feeds SET last_hash=$2,last_prices=$3 WHERE id=$1',[feed.id,data.hash,Object.fromEntries(data.cards.map(card=>[card.id,card.value]))]);await c.query('COMMIT');
 }catch(e){await c.query('ROLLBACK').catch(()=>{});const detail=e instanceof Error?e.message:'Posting failed.';await c.query('UPDATE futbot_feed_runs SET state=$2,detail=$3 WHERE id=$1',[run,(sending||sent)?(e instanceof FeedDeliveryError&&!e.uncertain?'failed':'uncertain'):'skipped',detail.slice(0,250)]);}
 }catch(e){logFailure('Server feed cycle failed',e);}finally{await c.query('SELECT pg_advisory_unlock(hashtext($1))',['feed:'+candidate.id]).catch(()=>{});c.release();}}
}
