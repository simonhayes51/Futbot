import {communityRoute,benefits} from './community.js';
import {Billing} from './billing.js';
import {requireServerPlan} from './plans.js';
import {alertPrices} from './alert-view.js';
import 'dotenv/config';
import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve,extname,sep} from 'node:path';
import type pg from 'pg';
import {randomToken,hash,same,encrypt,decrypt,signState,validState,canManage,discord,channelPermissions,HttpError} from './auth.js';
import {guildSettings,saveBrand,validateBrand,watchedMarkets,watch} from './settings.js';
import {MarketService,fodderRows,movers,ratingValue,targetValue,fodderIndex} from './market.js';
import {PriceRepository,isMiscItemType,miscItemLabel} from './prices.js';
import {AlertRepository} from './alerts.js';
import {fodderBoard} from './boards.js';
import {marketChart} from './chart.js';
import {errorDetails,logFailure} from './logging.js';
import {coins,isFresh} from './domain.js';
const root=resolve(fileURLToPath(new URL('../dist/',import.meta.url)));
const cookies=(req:IncomingMessage)=>Object.fromEntries((req.headers.cookie??'').split(';').map(v=>v.trim().split('=')));
function selectedMarket(value:unknown,fallback:string){if(value===undefined||value===null||value==='')return fallback;if(value==='ps5'||value==='pc')return value;throw new HttpError(400,'Choose PS5/Xbox Console or PC.');}
export function safeStaticPath(path:string){const p=resolve(root,'.'+path);if(p!==root&&!p.startsWith(root+sep))throw new HttpError(404,'Not found');return p;}
export function createWeb(prices:PriceRepository,alerts:AlertRepository,market:MarketService){
 const publicUrl=process.env.PUBLIC_URL,clientId=process.env.DISCORD_CLIENT_ID,secret=process.env.SESSION_SECRET,clientSecret=process.env.DISCORD_CLIENT_SECRET,botToken=process.env.DISCORD_TOKEN;
 if(!publicUrl||!clientId||!clientSecret||!secret||secret.length<32||!botToken)throw new Error('Dashboard needs PUBLIC_URL, DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_TOKEN and SESSION_SECRET (32+ characters).');
 const origin=new URL(publicUrl).origin;if(!origin.startsWith('https://')&&!/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin))throw new Error('PUBLIC_URL must use HTTPS.');
 const billing=new Billing(alerts.pool,origin),marketCache=new Map<string,MarketService>([[market.platform,market]]);const marketFor=(platform:string)=>{let value=marketCache.get(platform);if(!value){value=new MarketService(prices,platform,market.maxAge);marketCache.set(platform,value);}return value;};
 const secure=origin.startsWith('https://'),cookieName=secure?'__Host-futbot':'futbot';
 const cookie=(name:string,value:string,seconds:number)=>`${name}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${seconds}${secure?'; Secure':''}`;
 const redirectUri=origin+'/auth/callback',rate=new Map<string,{start:number;n:number}>();
 let botUser:any;const botIdentity=async()=>botUser??(botUser=await discord('/users/@me',botToken));
 async function session(req:IncomingMessage){const token=cookies(req)[cookieName];if(!token)throw new HttpError(401,'Sign in with Discord to continue.');const {rows}=await alerts.pool.query('SELECT * FROM futbot_sessions WHERE session_hash=$1 AND expires_at>now()',[hash(token)]);if(!rows[0])throw new HttpError(401,'Your session expired. Sign in again.');return rows[0];}
 async function guilds(s:any,fresh=false){return await discord('/users/@me/guilds?limit=200',decrypt(s.token_cipher,secret!), 'GET',undefined,true,fresh) as any[];}
 async function admin(s:any,id:string,fresh=false){if(!/^\d{17,20}$/.test(id))throw new HttpError(400,'Invalid server ID.');const g=(await guilds(s,fresh)).find(g=>g.id===id);if(!g||!canManage(g))throw new HttpError(403,'Manage Server or Administrator permission is required.');await discord('/guilds/'+id,botToken!,'GET',undefined,false,fresh);return g;}
 async function channels(guildId:string,fresh=false){const [list,roles,guild,bot]=await Promise.all([discord(`/guilds/${guildId}/channels`,botToken!,'GET',undefined,false,fresh),discord(`/guilds/${guildId}/roles`,botToken!,'GET',undefined,false,fresh),discord(`/guilds/${guildId}`,botToken!,'GET',undefined,false,fresh),botIdentity()]);const member=await discord(`/guilds/${guildId}/members/${bot.id}`,botToken!,'GET',undefined,false,fresh);return list.filter((c:any)=>[0,5].includes(c.type)&&channelPermissions(guild,roles,member,c)).map((c:any)=>({id:c.id,name:c.name}));}
 async function audit(s:any,id:string,action:string,details:unknown={}){await alerts.pool.query('INSERT INTO futbot_audit(guild_id,user_id,action,details) VALUES($1,$2,$3,$4)',[id,s.user_id,action,details]);}
 async function body(req:IncomingMessage){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>16000)throw new HttpError(413,'Request too large.');}try{return JSON.parse(raw||'{}');}catch{throw new HttpError(400,'Invalid JSON.');}}
 const server=createServer((req,res)=>{void handle(req,res).catch(e=>{if(res.headersSent){res.end();return;}const databaseError=!(e instanceof HttpError)&&'code' in Object(e);const status=e instanceof HttpError?e.status:databaseError?503:400;if(databaseError)logFailure('Dashboard request '+(req.url??'').split('?')[0],e);const detail=errorDetails(e);json(res,status,{error:e instanceof HttpError?e.message:databaseError?`${detail.hint} (code ${detail.code})`:e instanceof Error?e.message:'Request failed.'});});});
 function json(res:ServerResponse,status:number,value:unknown){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));}
 function redirect(res:ServerResponse,path:string){res.writeHead(302,{Location:path});res.end();}
 async function handle(req:IncomingMessage,res:ServerResponse){
 res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' https: data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
 const url=new URL(req.url??'/',origin),path=url.pathname,method=req.method??'GET';
 if(path==='/webhooks/stripe'&&method==='POST'){let raw=Buffer.alloc(0);for await(const chunk of req){raw=Buffer.concat([raw,Buffer.from(chunk)]);if(raw.length>1000000)throw new HttpError(413,'Webhook too large.');}try{await billing.webhook(raw,String(req.headers['stripe-signature']??''));}catch(e){if(e instanceof Error&&e.message==='Invalid webhook signature.')throw new HttpError(400,e.message);throw new HttpError(503,'Webhook processing failed; retry delivery.');}json(res,200,{received:true});return;}
 if(path==='/healthz'){json(res,200,{ok:true,service:'FutBot dashboard'});return;}
 if(path.startsWith('/api/')||path.startsWith('/auth/')){
 const ip=req.socket.remoteAddress??'local',now=Date.now();let r=rate.get(ip);if(!r||now-r.start>60000){r={start:now,n:0};rate.set(ip,r);}if(++r.n>600)throw new HttpError(429,'Too many requests. Try again shortly.');if(rate.size>10000)for(const [k,v]of rate)if(now-v.start>60000)rate.delete(k);
 res.setHeader('Cache-Control','no-store');
 }
 if(path==='/auth/login'&&method==='GET'){const state=signState(randomToken(),secret!);res.setHeader('Set-Cookie',cookie('futbot_oauth',state,600));redirect(res,'https://discord.com/oauth2/authorize?'+new URLSearchParams({client_id:clientId!,response_type:'code',redirect_uri:redirectUri,scope:'identify guilds',state}));return;}
 if(path==='/auth/callback'&&method==='GET'){
 const state=url.searchParams.get('state')??'',code=url.searchParams.get('code');res.setHeader('Set-Cookie',cookie('futbot_oauth','',0));if(!code||!same(state,cookies(req).futbot_oauth??'')||!validState(state,secret!))throw new HttpError(400,'Discord login expired or could not be verified. Start sign-in again.');
 const response=await fetch('https://discord.com/api/v10/oauth2/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:clientId!,client_secret:clientSecret!,grant_type:'authorization_code',code,redirect_uri:redirectUri}),signal:AbortSignal.timeout(12000)});
 if(!response.ok)throw new HttpError(401,'Discord login failed. Start sign-in again.');const t=await response.json() as any,profile=await discord('/users/@me',t.access_token,'GET',undefined,true),token=randomToken();
 const user={id:profile.id,name:profile.global_name??profile.username,avatar:profile.avatar?`https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png`:null};
 await alerts.pool.query('DELETE FROM futbot_sessions WHERE expires_at<=now()');
 await alerts.pool.query('INSERT INTO futbot_sessions(session_hash,user_id,profile,token_cipher,csrf,expires_at) VALUES($1,$2,$3,$4,$5,now()+($6::int * interval \'1 second\'))',[hash(token),profile.id,user,encrypt(t.access_token,secret!),randomToken(),Math.min(43200,Number(t.expires_in)||3600)]);
 res.setHeader('Set-Cookie',[cookie('futbot_oauth','',0),cookie(cookieName,token,43200)]);redirect(res,'/app/');return;
 }
 if(path.startsWith('/api/')){
 const s=await session(req);if(!['GET','HEAD'].includes(method)){if(req.headers.origin!==origin||!same(String(req.headers['x-csrf-token']??''),s.csrf))throw new HttpError(403,'Request could not be verified. Refresh the page.');}
 if(path==='/api/me'&&method==='GET'){const access=await benefits(alerts.pool,s.user_id);json(res,200,{user:s.profile,csrf:s.csrf,year:prices.year,platform:market.platform,alertLimit:access.alerts,watchLimit:access.watch});return;}
 const extra=await communityRoute({pool:alerts.pool,market,billing,user:s.user_id,path,method,read:()=>body(req),admin:id=>admin(s,id,method!=='GET'),audit:(id,action,details)=>audit(s,id,action,details),memberGuilds:async()=>{const [list,installed]=await Promise.all([guilds(s),discord('/users/@me/guilds?limit=200',botToken!)]);const ids=new Set(installed.map((g:any)=>g.id));return list.filter(g=>ids.has(g.id)).map(g=>({id:g.id,name:g.name}));}});if(extra!==undefined){json(res,200,extra);return;}
 if(path==='/api/logout'&&method==='POST'){await alerts.pool.query('DELETE FROM futbot_sessions WHERE session_hash=$1',[s.session_hash]);res.setHeader('Set-Cookie',cookie(cookieName,'',0));json(res,200,{ok:true});return;}
 if(path==='/api/guilds'&&method==='GET'){const [list,installed]=await Promise.all([guilds(s),discord('/users/@me/guilds?limit=200',botToken!)]);const ids=new Set(installed.map((g:any)=>g.id));json(res,200,{guilds:list.filter(canManage).filter(g=>ids.has(g.id)).map(g=>({id:g.id,name:g.name,icon:g.icon?`https://cdn.discordapp.com/icons/${g.id}/${g.icon}.png`:null}))});return;}
 if(path==='/api/fodder-alerts'){
  const platform=selectedMarket(url.searchParams.get('platform'),market.platform);
  if(method==='GET'){const rows=(await alerts.pool.query('SELECT id,rating,platform,baseline_price,drop_percent,target_price,state,created_at,triggered_at FROM futbot_fodder_alerts WHERE user_id=$1 AND game_year=$2 AND platform=$3 ORDER BY id DESC',[s.user_id,prices.year,platform])).rows;const current=await Promise.all([...new Set(rows.map(r=>Number(r.rating)))].map(async rating=>({rating,index:await prices.fodderIndex(platform,rating,market.maxAge)})));json(res,200,{alerts:rows,current});return;}
  const b=await body(req);if(method==='POST'){const rating=ratingValue(b.rating),drop=Number(b.dropPercent);if(!Number.isFinite(drop)||drop<1||drop>50)throw new HttpError(400,'Choose a drop between 1% and 50%.');const chosen=selectedMarket(b.platform,market.platform),source=marketFor(chosen),cards=await source.snapshot(),baseline=fodderIndex(cards,rating);if(!baseline)throw new HttpError(409,'There are not three fresh, tradeable cards at this rating yet.');const access=await benefits(alerts.pool,s.user_id),target=Math.max(1,Math.floor(baseline*(1-drop/100))),c=await alerts.pool.connect();try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[s.user_id]);const count=await c.query("SELECT (SELECT count(*) FROM futbot_alerts WHERE user_id=$1 AND state IN ('active','queued','paused'))+(SELECT count(*) FROM futbot_fodder_alerts WHERE user_id=$1 AND state IN ('active','queued'))+(SELECT count(*) FROM futbot_misc_alerts WHERE user_id=$1 AND state IN ('active','queued')) AS n",[s.user_id]);if(Number(count.rows[0].n)>=access.alerts)throw new HttpError(400,`Your saved alert limit is ${access.alerts}. Remove an existing alert or upgrade in Plans & billing.`);await c.query('INSERT INTO futbot_fodder_alerts(user_id,game_year,platform,rating,baseline_price,drop_percent,target_price) VALUES($1,$2,$3,$4,$5,$6,$7)',[s.user_id,prices.year,chosen,rating,baseline,drop,target]);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}json(res,200,{ok:true});return;}
  if(method==='DELETE'){if(!/^\d+$/.test(String(b.id)))throw new HttpError(400,'Invalid fodder alert.');const deleted=await alerts.pool.query("UPDATE futbot_fodder_alerts SET state='cancelled' WHERE id=$1 AND user_id=$2 AND state IN ('active','failed') RETURNING id",[b.id,s.user_id]);if(!deleted.rowCount)throw new HttpError(409,'This fodder alert cannot be cancelled.');json(res,200,{ok:true});return;}throw new HttpError(405,'Method not supported');
 }
 if(path==='/api/consumables'&&method==='GET'){
  const platform=selectedMarket(url.searchParams.get('platform'),market.platform);
  let items;
  try{items=(await prices.miscItems(platform)).map(item=>({...item,fresh:isFresh(item.captured_at,Math.max(30,market.maxAge))}));}catch(error){if((error as any)?.code==='42P01')throw new HttpError(503,'Consumable prices are not connected yet. Deploy the TradeHQ misc-price feed first.');throw error;}
  const [saved,alertRows]=await Promise.all([
    alerts.pool.query(`SELECT item_type,item_id::text,starting_price,watched_at FROM futbot_misc_watchlist WHERE user_id=$1 AND game_year=$2 AND platform=$3`,[s.user_id,prices.year,platform]),
    alerts.pool.query(`SELECT id,item_type,item_id::text,item_label,direction,target_price,baseline_price,state,created_at,triggered_at FROM futbot_misc_alerts WHERE user_id=$1 AND game_year=$2 AND platform=$3 ORDER BY id DESC LIMIT 100`,[s.user_id,prices.year,platform])
  ]);
  const byKey=new Map(items.map(i=>[`${i.item_type}:${i.item_id}`,i]));
  const watchlist=saved.rows.map(w=>({...w,current:byKey.get(`${w.item_type}:${w.item_id}`)??null}));
  const alertsWithCurrent=alertRows.rows.map(a=>({...a,current:byKey.get(`${a.item_type}:${a.item_id}`)??null}));
  json(res,200,{platform,items,watchlist,alerts:alertsWithCurrent});return;
 }
 if(path==='/api/consumable-history'&&method==='GET'){
  const platform=selectedMarket(url.searchParams.get('platform'),market.platform);
  const itemType=url.searchParams.get('type')??'',itemId=url.searchParams.get('id')??'';
  if(!isMiscItemType(itemType)||!/^\d+$/.test(itemId))throw new HttpError(400,'Choose a valid consumable.');
  const hours=url.searchParams.get('hours')==='24'?24:168;
  const [item,history]=await Promise.all([prices.miscLatest(itemType,itemId,platform),prices.miscHistory(itemType,itemId,platform,hours)]);
  json(res,200,{platform,item,history,hours});return;
 }
 if(path==='/api/consumable-watchlist'){
  const b=method==='GET'?{}:await body(req);
  const itemType=String(b.itemType??''),itemId=String(b.itemId??''),platform=selectedMarket(b.platform,market.platform);
  if(method==='POST'){
   if(!isMiscItemType(itemType)||!/^\d+$/.test(itemId))throw new HttpError(400,'Choose a valid consumable.');
   const access=await benefits(alerts.pool,s.user_id),c=await alerts.pool.connect();
   try{
    await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[s.user_id]);
    const count=await c.query(`SELECT ((SELECT count(*) FROM futbot_watchlist WHERE user_id=$1 AND game_year=$2)+(SELECT count(*) FROM futbot_misc_watchlist WHERE user_id=$1 AND game_year=$2))::int AS n`,[s.user_id,prices.year]);
    if(Number(count.rows[0].n)>=access.watch)throw new HttpError(400,`Your saved watchlist limit is ${access.watch}. Remove an item or upgrade in Plans & billing.`);
    const latest=await prices.miscLatest(itemType,itemId,platform),start=latest&&latest.price!==null&&Number(latest.price)>0&&isFresh(latest.captured_at,Math.max(30,market.maxAge))?latest.price:null;
    await c.query(`INSERT INTO futbot_misc_watchlist(user_id,game_year,platform,item_type,item_id,starting_price) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,[s.user_id,prices.year,platform,itemType,itemId,start]);
    await c.query('COMMIT');
   }catch(error){await c.query('ROLLBACK');throw error;}finally{c.release();}
   json(res,200,{ok:true});return;
  }
  if(method==='DELETE'){
   if(!isMiscItemType(itemType)||!/^\d+$/.test(itemId))throw new HttpError(400,'Choose a valid consumable.');
   await alerts.pool.query(`DELETE FROM futbot_misc_watchlist WHERE user_id=$1 AND game_year=$2 AND platform=$3 AND item_type=$4 AND item_id=$5`,[s.user_id,prices.year,platform,itemType,itemId]);json(res,200,{ok:true});return;
  }
  throw new HttpError(405,'Method not supported');
 }
 if(path==='/api/consumable-alerts'){
  if(method==='GET'){
   const platform=selectedMarket(url.searchParams.get('platform'),market.platform);
   const result=await alerts.pool.query(`SELECT id,item_type,item_id::text,item_label,direction,target_price,baseline_price,state,created_at,triggered_at FROM futbot_misc_alerts WHERE user_id=$1 AND game_year=$2 AND platform=$3 ORDER BY id DESC LIMIT 100`,[s.user_id,prices.year,platform]);
   const withCurrent=await Promise.all(result.rows.map(async a=>({...a,current:await prices.miscLatest(a.item_type,a.item_id,platform)})));
   json(res,200,{alerts:withCurrent,platform});return;
  }
  const b=await body(req);
  if(method==='POST'){
   const itemType=String(b.itemType??''),itemId=String(b.itemId??''),platform=selectedMarket(b.platform,market.platform),direction=b.direction;
   if(!isMiscItemType(itemType)||!/^\d+$/.test(itemId))throw new HttpError(400,'Choose a valid consumable.');
   if(!['below','above'].includes(direction))throw new HttpError(400,'Choose a valid alert direction.');
   const target=targetValue(b.target),latest=await prices.miscLatest(itemType,itemId,platform);
   if(!latest||latest.price===null||latest.price<=0||!isFresh(latest.captured_at,Math.max(30,market.maxAge)))throw new HttpError(409,'There is no fresh listed price for this item yet.');
   const access=await benefits(alerts.pool,s.user_id);
   try{await alerts.createMisc({userId:s.user_id,year:prices.year,platform,itemType,itemId,itemLabel:miscItemLabel(itemType,itemId),direction,target,baseline:latest.price},access.alerts);}
   catch(error){throw new HttpError(400,error instanceof Error?error.message:'Could not create alert.');}
   json(res,200,{ok:true});return;
  }
  if(method==='DELETE'){
   const id=String(b.id??'');if(!/^\d+$/.test(id))throw new HttpError(400,'Invalid consumable alert.');
   const deleted=await alerts.pool.query(`UPDATE futbot_misc_alerts SET state='cancelled' WHERE id=$1 AND user_id=$2 AND state IN ('active','failed') RETURNING id`,[id,s.user_id]);
   if(!deleted.rowCount)throw new HttpError(409,'This consumable alert cannot be cancelled.');json(res,200,{ok:true});return;
  }
  throw new HttpError(405,'Method not supported');
 }
 if(path==='/api/market'&&method==='GET'){const platform=selectedMarket(url.searchParams.get('platform'),market.platform),source=marketFor(platform),cards=await source.snapshot(),rating=url.searchParams.has('rating')?ratingValue(url.searchParams.get('rating')):undefined,rarity=url.searchParams.get('rarity')||undefined,rows=fodderRows(cards,rating);json(res,200,{platform,fodder:rows,fodderIndices:rows.map(r=>({rating:r.rating,value:fodderIndex(cards,r.rating)})),risers:movers(cards,'risers',rarity),fallers:movers(cards,'fallers',rarity),rarities:[...new Set(cards.map(c=>c.rarity).filter(Boolean))].sort(),freshCards:cards.length,cachedForSeconds:300});return;}
 if(path==='/api/budget'&&method==='GET'){const budget=targetValue(url.searchParams.get('coins')),position=(url.searchParams.get('position')??'').toUpperCase(),platform=selectedMarket(url.searchParams.get('platform'),market.platform),source=marketFor(platform);if(position&&!['GK','CB','LB','RB','CDM','CM','CAM','LM','RM','LW','RW','ST'].includes(position))throw new HttpError(400,'Choose a valid primary position.');const cards=(await source.snapshot()).filter(c=>c.value<=budget&&(!position||c.position===position)).sort((a,b)=>(b.rating??0)-(a.rating??0)||a.value-b.value).slice(0,25);json(res,200,{cards,platform});return;}
 if(path==='/api/investments'){
 if(method==='GET'){const platform=selectedMarket(url.searchParams.get('platform'),market.platform),rows=(await alerts.pool.query('SELECT id,card_id::text,card_name,buy_price,quantity,platform,created_at FROM futbot_investments WHERE user_id=$1 AND game_year=$2 AND platform=$3 ORDER BY id DESC LIMIT 100',[s.user_id,prices.year,platform])).rows;const holdings=await Promise.all(rows.map(async h=>{const [p,card]=await Promise.all([prices.latest(h.card_id,h.platform),prices.card(h.card_id)]),fresh=!!p&&isFresh(p.capturedAt,market.maxAge),currentValue=fresh?Math.floor(p!.value*.95)*h.quantity:null,cost=h.buy_price*h.quantity,profit=fresh?currentValue!-cost:null;return {...h,card,value:fresh?p!.value:null,fresh,profit,currentValue,cost,roi:profit===null||!cost?null:profit/cost*100,breakEven:Math.ceil(h.buy_price/.95)};}));json(res,200,{holdings,platform});return;}
 const b=await body(req);
 if(method==='POST'){if(!/^\d+$/.test(String(b.cardId)))throw new HttpError(400,'Choose a valid card ID.');const card=await prices.card(b.cardId);if(!card)throw new HttpError(404,'Card not found.');const platform=selectedMarket(b.platform,market.platform),buy=targetValue(b.buy),quantity=Number(b.quantity);if(!Number.isInteger(quantity)||quantity<1||quantity>1000)throw new HttpError(400,'Choose 1 to 1,000 copies.');const c=await alerts.pool.connect();try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[s.user_id]);const count=await c.query('SELECT count(*)::int AS n FROM futbot_investments WHERE user_id=$1',[s.user_id]);if(count.rows[0].n>=100)throw new HttpError(400,'Maximum 100 investment records.');await c.query('INSERT INTO futbot_investments(user_id,card_id,card_name,game_year,platform,buy_price,quantity) VALUES($1,$2,$3,$4,$5,$6,$7)',[s.user_id,card.id,card.name,prices.year,platform,buy,quantity]);await c.query('COMMIT');}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}}
 else if(method==='DELETE'){if(!/^\d+$/.test(String(b.id)))throw new HttpError(400,'Invalid record.');await alerts.pool.query('DELETE FROM futbot_investments WHERE id=$1 AND user_id=$2',[b.id,s.user_id]);}else throw new HttpError(405,'Method not supported');json(res,200,{ok:true});return;
 }
 if(path==='/api/search'&&method==='GET'){const q=(url.searchParams.get('q')??'').trim().slice(0,80),rarity=(url.searchParams.get('rarity')??'').trim().slice(0,80)||undefined,rawRating=url.searchParams.get('rating'),rating=rawRating?ratingValue(rawRating):undefined,position=(url.searchParams.get('position')??'').toUpperCase()||undefined;json(res,200,{cards:q.length>=2?await prices.search(q,{rarity,rating,position}):[]});return;}
 if(path==='/api/card-types'&&method==='GET'){json(res,200,{rarities:await prices.cardTypes()});return;}
 if(path==='/api/card'&&method==='GET'){const id=url.searchParams.get('id')??'';if(!/^\d+$/.test(id))throw new HttpError(400,'Choose a player first.');const pricePlatform=selectedMarket(url.searchParams.get('platform'),market.platform);const card=await prices.card(id);if(!card)throw new HttpError(404,'Card not found.');const hours=url.searchParams.get('hours')==='168'?168:24;const [price,history]=await Promise.all([prices.latest(id,pricePlatform),prices.history(id,pricePlatform,hours)]);json(res,200,{card,platform:pricePlatform,price,history,fresh:price?isFresh(price.capturedAt,market.maxAge):false});return;}
 if(path==='/api/chart'&&method==='GET'){const id=url.searchParams.get('id')??'';if(!/^\d+$/.test(id))throw new HttpError(400,'Invalid card.');const pricePlatform=selectedMarket(url.searchParams.get('platform'),market.platform);const card=await prices.card(id);if(!card)throw new HttpError(404,'Card not found.');const hours=url.searchParams.get('hours')==='168'?168:24,png=await marketChart(card.name+' / '+(hours===168?'7-day':'24-hour'),await prices.history(id,pricePlatform,hours));if(!png)throw new HttpError(404,'Not enough history yet.');res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'private, max-age=120'});res.end(png);return;}
 if(path==='/api/fodder-image'&&method==='GET'){const platform=selectedMarket(url.searchParams.get('platform'),market.platform),source=marketFor(platform),png=await fodderBoard(await source.snapshot(),undefined,prices.year);res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'private, max-age=120'});res.end(png);return;}
 if(path==='/api/watchlist'){
 if(method==='GET'){const platform=selectedMarket(url.searchParams.get('platform'),market.platform),saved=await watchedMarkets(alerts.pool,s.user_id,prices.year,platform);const cards=await Promise.all(saved.map(async (row,index)=>{const history=index<6?await prices.history(row.id,row.platform,24).catch(()=>[]):[];const [card,p,b]=await Promise.all([prices.card(row.id),prices.latest(row.id,row.platform),prices.baseline(row.id,row.platform)]);const fresh=!!p&&isFresh(p.capturedAt,market.maxAge);return {...card,platform:row.platform,history,value:fresh?p!.value:null,capturedAt:p?.capturedAt??null,startingPrice:row.startingPrice,watchedAt:row.watchedAt,change:fresh&&b?.value?(p!.value-b.value)/b.value*100:null,stale:!fresh};}));json(res,200,{cards:cards.filter(c=>c.id),platform});return;}
 const b=await body(req);if(!/^\d+$/.test(String(b.id)))throw new HttpError(400,'Choose an exact card.');const pricePlatform=selectedMarket(b.platform,market.platform);if(method==='POST'){if(!await prices.card(b.id))throw new HttpError(404,'Card not found.');const p=await prices.latest(b.id,pricePlatform),start=p&&isFresh(p.capturedAt,market.maxAge)?p.value:null;await watch(alerts.pool,s.user_id,b.id,prices.year,pricePlatform,(await benefits(alerts.pool,s.user_id)).watch,start);}else if(method==='DELETE')await alerts.pool.query('DELETE FROM futbot_watchlist WHERE user_id=$1 AND card_id=$2 AND game_year=$3 AND platform=$4',[s.user_id,b.id,prices.year,pricePlatform]);else throw new HttpError(405,'Method not supported');json(res,200,{ok:true});return;}
 if(path==='/api/alerts'){
 if(method==='GET'){json(res,200,{alerts:await alertPrices((await alerts.pool.query('SELECT id,card_id::text,card_name,game_year,platform,direction,target::int,state,created_at,triggered_at FROM futbot_alerts WHERE user_id=$1 ORDER BY id DESC LIMIT 100',[s.user_id])).rows,prices,market.maxAge)});return;}
 const b=await body(req);if(method==='POST'){if(!/^\d+$/.test(String(b.cardId)))throw new HttpError(400,'Choose a card.');const card=await prices.card(b.cardId);if(!card)throw new HttpError(404,'Card not found.');if(!['above','below'].includes(b.direction))throw new HttpError(400,'Choose above or below.');const pricePlatform=selectedMarket(b.platform,market.platform);await alerts.create({userId:s.user_id,guildId:null,cardId:card.id,cardName:card.name,year:prices.year,platform:pricePlatform,direction:b.direction,target:targetValue(b.target)},(await benefits(alerts.pool,s.user_id)).alerts);}
 else if(method==='PATCH'&&b.target!==undefined){if(!/^\d+$/.test(String(b.id)))throw new HttpError(400,'Invalid alert.');await alerts.edit(s.user_id,String(b.id),targetValue(b.target),b.direction);}
 else if(method==='PATCH'){if(!/^\d+$/.test(String(b.id))||!['active','paused'].includes(b.state))throw new HttpError(400,'Invalid alert control.');const r=await alerts.pool.query('UPDATE futbot_alerts SET state=$1 WHERE id=$2 AND user_id=$3 AND state=$4 RETURNING id',[b.state,b.id,s.user_id,b.state==='active'?'paused':'active']);if(!r.rowCount)throw new HttpError(409,'Alert has changed or does not belong to you.');}
 else if(method==='DELETE'){if(!/^\d+$/.test(String(b.id)))throw new HttpError(400,'Invalid alert.');if(!await alerts.remove(s.user_id,b.id))throw new HttpError(409,'This alert cannot be cancelled. It may already be queued.');}else throw new HttpError(405,'Method not supported');json(res,200,{ok:true});return;}
 if(path==='/api/testdm'&&method==='POST'){const dm=await discord('/users/@me/channels',botToken!,'POST',{recipient_id:s.user_id});await discord('/channels/'+dm.id+'/messages',botToken!,'POST',{content:'🔔 FutBot test notification — your private messages are connected.',allowed_mentions:{parse:[]}});json(res,200,{ok:true});return;}
 if(/^\/api\/guilds\/\d{17,20}\/feed-image$/.test(path)&&method==='GET'){const id=path.split('/')[3];await admin(s,id);const b=await guildSettings(alerts.pool,id),png=await fodderBoard(await market.snapshot(),undefined,prices.year,b);res.writeHead(200,{'Content-Type':'image/png','Cache-Control':'private, max-age=120'});res.end(png);return;}
 const match=path.match(/^\/api\/guilds\/(\d+)\/(settings|channels|activity|publish)$/);if(match){const [,id,action]=match;await admin(s,id,!['GET','HEAD'].includes(method));
 if(action==='settings'&&method==='GET'){json(res,200,await guildSettings(alerts.pool,id));return;}
 if(action==='channels'&&method==='GET'){json(res,200,{channels:await channels(id)});return;}
 if(action==='settings'&&method==='PUT'){await requireServerPlan(alerts.pool,id);const b=validateBrand(await body(req));if(b.settings.fodderChannel&&!(await channels(id,true)).some((c:any)=>c.id===b.settings.fodderChannel))throw new HttpError(403,'FutBot needs View Channel, Send Messages and Embed Links there.');if(b.settings.accessRoleIds?.length){const roles=await discord(`/guilds/${id}/roles`,botToken!,'GET',undefined,false,true);if(b.settings.accessRoleIds.some(r=>!roles.some((role:any)=>role.id===r)))throw new HttpError(400,'Choose roles from this server.');}await saveBrand(alerts.pool,id,b);await audit(s,id,'settings.updated',{name:b.name,accent:b.accent});json(res,200,{ok:true});return;}
 if(action==='activity'&&method==='GET'){const data=await alerts.pool.query('SELECT action,created_at,details FROM futbot_audit WHERE guild_id=$1 ORDER BY id DESC LIMIT 30',[id]);json(res,200,{activity:data.rows});return;}
 if(action==='publish'&&method==='POST'){
 await requireServerPlan(alerts.pool,id);
 const b=await guildSettings(alerts.pool,id),channel=b.settings.fodderChannel;if(!channel||!(await channels(id,true)).some((c:any)=>c.id===channel))throw new HttpError(400,'Save a channel that FutBot can post to first.');
 const lock=await alerts.pool.connect();try{await lock.query('BEGIN');await lock.query('SELECT pg_advisory_xact_lock(hashtext($1))',['publish:'+id]);const recent=await lock.query("SELECT 1 FROM futbot_audit WHERE guild_id=$1 AND action='fodder.published' AND created_at>now()-interval '1 minute'",[id]);if(recent.rowCount)throw new HttpError(429,'Wait one minute before publishing again.');
 const cards=await market.snapshot();if(fodderRows(cards).some(r=>!r.cards.length))throw new HttpError(503,'Waiting for a complete, fresh fodder ladder.');const png=await fodderBoard(cards,undefined,prices.year,b),form=new FormData();form.set('payload_json',JSON.stringify({embeds:[{author:{name:b.name},title:'🧱 FODDER WATCH',description:'The cheapest fresh cards by rating. Check SBC requirements before buying.',color:parseInt(b.accent.slice(1),16),image:{url:'attachment://fodder.png'},footer:{text:b.footer+' • '+market.platform.toUpperCase()}}],attachments:[{id:0,filename:'fodder.png'}],allowed_mentions:{parse:[]}}));form.set('files[0]',new Blob([new Uint8Array(png)],{type:'image/png'}),'fodder.png');
 const response=await fetch('https://discord.com/api/v10/channels/'+channel+'/messages',{method:'POST',headers:{Authorization:'Bot '+botToken},body:form,signal:AbortSignal.timeout(20000)});if(!response.ok)throw new HttpError(502,'Discord could not publish the board. Check Attach Files permission.');const message=await response.json() as any;await lock.query("INSERT INTO futbot_audit(guild_id,user_id,action,details) VALUES($1,$2,'fodder.published',$3)",[id,s.user_id,{channel,messageId:message.id}]);await lock.query('COMMIT');json(res,200,{ok:true,url:`https://discord.com/channels/${id}/${channel}/${message.id}`});}catch(e){await lock.query('ROLLBACK');throw e;}finally{lock.release();}return;
 }
 throw new HttpError(405,'Method not supported');}
 throw new HttpError(404,'Endpoint not found');
 }
 if(method!=='GET'&&method!=='HEAD')throw new HttpError(405,'Method not supported');
 let file=safeStaticPath(decodeURIComponent(path));try{if((await stat(file)).isDirectory())file=resolve(file,'index.html');const bytes=await readFile(file);const mime:Record<string,string>={'.html':'text/html; charset=utf-8','.css':'text/css','.js':'text/javascript','.webp':'image/webp','.png':'image/png','.svg':'image/svg+xml'};res.writeHead(200,{'Content-Type':mime[extname(file)]??'application/octet-stream','Cache-Control':'no-cache'});res.end(method==='HEAD'?undefined:bytes);}catch{throw new HttpError(404,'Page not found');}
 }
 return server;
}
export function startWeb(prices:PriceRepository,alerts:AlertRepository,market:MarketService){const server=createWeb(prices,alerts,market);const port=Number(process.env.PORT||3000);server.listen(port,'0.0.0.0',()=>console.log(`FutBot dashboard listening on ${port}`));return server;}
