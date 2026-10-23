import {isUnreleasedEvent,unreleasedRecords,unreleasedReason,queueUnreleased} from './content-watch-unreleased.js';
import 'dotenv/config';
import {mkdir,readFile,writeFile,rename,rm,open} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseArgs} from 'node:util';
import {PriceRepository} from './prices.js';
import {readMarketPlayers} from './content-watch-players.js';
import pg from 'pg';
import {databaseWatch,type WatchMetadata} from './content-watch-store.js';
import {readHar,makeCapture,applyCapture,emptyState,publicContentUrl,shortlist,ruleText,type WatchState,type Change,type Capture,type Document,type Player,type Definition} from './content-watch.js';

const MAX_BODY=30*1024*1024;
export async function fetchPublic(url:string,fetcher:typeof fetch=fetch):Promise<Document>{
 if(!publicContentUrl(url))throw new Error('Only the discovered public EA localisation and pack catalogue URLs are allowed');
 const r=await fetcher(url,{headers:{accept:'application/json, application/xml, text/xml','user-agent':'FutBot-ContentWatch/1.0'},redirect:'error',signal:AbortSignal.timeout(20000)});
 if(!r.ok)throw new Error(`Public content returned HTTP ${r.status}`);
 if(Number(r.headers.get('content-length'))>MAX_BODY)throw new Error('Public content exceeded size limit');
 if(!r.body)throw new Error('Empty public content response');
 const reader=r.body.getReader(),chunks:Uint8Array[]=[];let bytes=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>MAX_BODY)throw new Error('Public content exceeded size limit');chunks.push(value);}}finally{await reader.cancel();}
 const text=Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/,'');const body=url.endsWith('.xml')?text:JSON.parse(text);
 if(url.endsWith('.xml')&&!/<xliff\b/.test(text))throw new Error('Unexpected pack catalogue response');
 if(!url.endsWith('.xml')&&(!body||typeof body!=='object'||Array.isArray(body)))throw new Error('Unexpected localisation response');
 return {url,capturedAt:new Date().toISOString(),body};
}
export async function atomicJson(path:string,value:unknown):Promise<void>{
 const temp=path+`.${process.pid}.tmp`;await writeFile(temp,JSON.stringify(value,null,2)+'\n',{mode:0o600});await rename(temp,path);
}
export async function loadState(dir:string,year:number):Promise<WatchState>{
 try{const s=JSON.parse(await readFile(join(dir,'state.json'),'utf8')) as WatchState;if(s.version!==1||s.gameYear!==year||!s.records||!Array.isArray(s.events))throw new Error('Incompatible content-watch state');return s;}catch(e:any){if(e.code==='ENOENT')return emptyState(year);throw e;}
}
export async function withLock<T>(dir:string,work:()=>Promise<T>):Promise<T>{
 await mkdir(dir,{recursive:true,mode:0o700});const lock=join(dir,'writer.lock');
 try{const handle=await open(lock,'wx',0o600);await handle.writeFile(String(process.pid));await handle.close();}catch(e:any){if(e.code==='EEXIST')throw new Error('Content-watch state is locked by another process. Remove writer.lock only after confirming that process has stopped.');throw e;}
 try{return await work();}finally{await rm(lock,{force:true});}
}
function status(d:Definition,now=Date.now()):string{
 if(d.evidence==='catalogue-text')return 'CATALOGUE CLUE — release unconfirmed';
 if(d.release&&d.release*1000>now)return 'FUTURE RELEASE TIMESTAMP';
 if(d.expires&&d.expires*1000<=now)return 'EXPIRED DEFINITION';
 return 'SERVED DEFINITION — advance availability unproven';
}
export function changeMessage(event:Change,releaseBasis?:string):string{
 const d=event.after;const lines=[`Unreleased content ${event.type==='added'?'found':'updated'}: ${d.name}`,releaseBasis??status(d),`First observed change: ${event.at}`,d.description.slice(0,700),...d.rules.slice(0,10).map(ruleText)];
 if(event.before)lines.push('Changed fields: '+['name','description','rules','details','release','expires'].filter(k=>JSON.stringify((event.before as any)[k])!==JSON.stringify((d as any)[k])).join(', '));
 if(d.kind==='sbc-challenge')lines.push('SBC requirements: '+JSON.stringify(d.details.rawRequirements).slice(0,600));
 lines.push('Evidence: '+d.source,'Candidate signal only. No profit or release guarantee.');return lines.filter(Boolean).join('\n').slice(0,1900);
}
export async function deliverPending(state:WatchState,send:(event:Change)=>Promise<void>,save:()=>Promise<void>):Promise<number>{
 let sent=0;for(const event of state.events.filter(e=>!e.delivered)){if(!isUnreleasedEvent(state,event))continue;await send(event);event.delivered=true;await save();sent++;}return sent;
}
async function discordSender(userId:string,token:string,players:Player[],state:WatchState,platform:string,year:number,maxAge:number):(Promise<(event:Change)=>Promise<void>>){
 if(!/^\d{17,20}$/.test(userId))throw new Error('CONTENT_WATCH_USER_ID must be your Discord user ID');
 async function request(path:string,body:unknown){
  const r=await fetch('https://discord.com/api/v10'+path,{method:'POST',headers:{authorization:'Bot '+token,'content-type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
  if(!r.ok)throw new Error('Private Discord delivery returned HTTP '+r.status);return r.json() as Promise<any>;
 }
 const channel=await request('/users/@me/channels',{recipient_id:userId});
 if(!/^\d{17,20}$/.test(channel.id))throw new Error('Invalid private Discord channel');
 return async event=>{
  const matches=shortlist(event.after,players,platform,year,maxAge).filter(m=>m.result==='eligible'&&m.player.price!==undefined).slice(0,5);
  const picks=matches.length?'\nVerified eligible, fresh prices:\n'+matches.map(m=>`${m.player.name}: ${m.player.price!.toLocaleString('en-GB')} coins`).join('\n'):'\nNo fully verified shortlist with fresh prices available.';
  await request(`/channels/${channel.id}/messages`,{content:changeMessage(event,unreleasedReason(state,event.after)).slice(0,1500)+picks.slice(0,450),allowed_mentions:{parse:[]},nonce:event.id.slice(0,24),enforce_nonce:true});
 };
}
export function report(state:WatchState,players:Player[],platform:string,maxAge:number):string{
 const lines=[`# Unreleased content — FC${state.gameYear}`,`Last scan: ${state.lastRun??'never'}`,`EVO definitions captured: ${state.coverage?.evoFetched??0}/${state.coverage?.evoExpected??0}. Missing pages are not unreleased EVOs.`,
  'Only items with a current unreleased confirmation or future EA release timestamp are listed. First seen is the observation time, not a release time.',''];
 const rows=unreleasedRecords(state).sort((a,b)=>(b.definition.kind==='evo-clue'?1:0)-(a.definition.kind==='evo-clue'?1:0)||b.firstSeen.localeCompare(a.firstSeen));
 for(const row of rows){const d=row.definition;lines.push(`## ${d.name.replace(/[\r\n]/g,' ')} (${d.key})`,unreleasedReason(state,d)??status(d),`First seen: ${row.firstSeen} · Last seen: ${row.lastSeen}`,d.description,...d.rules.map(r=>'- '+ruleText(r)));
  if(d.kind==='sbc-challenge')lines.push('EA squad requirements: '+JSON.stringify(d.details.rawRequirements));
  if(d.kind==='evo')lines.push('EA level upgrades: '+JSON.stringify(d.details.levels));
  if(d.kind==='evo'||d.kind==='evo-clue'){
   const matches=shortlist(d,players,platform,state.gameYear,maxAge).slice(0,10);
   if(!players.length)lines.push('No enriched player feed supplied. No eligible-player or price claims.');
   else for(const m of matches)lines.push(`- ${m.player.name} [${m.player.id}] — ${m.result}; ${m.player.price===undefined?'no fresh price':m.player.price.toLocaleString('en-GB')+' coins'}; ${m.reasons.join('; ')}`);
  }
  lines.push('Source: '+d.source,'');
 }
 return lines.join('\n');
}
async function run():Promise<void>{
 const {values,positionals}=parseArgs({allowPositionals:true,options:{state:{type:'string'},har:{type:'string'},snapshot:{type:'string'},players:{type:'string'},database:{type:'boolean'},year:{type:'string'},platform:{type:'string'},baseline:{type:'boolean'},interval:{type:'string'},'max-age':{type:'string'},url:{type:'string',multiple:true},deliver:{type:'boolean'}}});
 const command=positionals[0]??'help',year=Number(values.year??process.env.GAME_YEAR??27),platform=values.platform??process.env.PLATFORM??'ps5',maxAge=Number(values['max-age']??15),interval=Number(values.interval??300);
 if(!Number.isInteger(year)||year<20||year>99||!['ps5','pc'].includes(platform)||!Number.isFinite(maxAge)||maxAge<=0||!Number.isFinite(interval)||interval<60)throw new Error('Invalid year, platform, price age or interval (minimum 60 seconds)');
 if(!['import','poll','watch','report','deliver'].includes(command)){console.log('content-watch import --har FILE [--baseline]\ncontent-watch import --snapshot FILE [--baseline]\ncontent-watch poll | watch [--interval 300] [--deliver]\ncontent-watch report [--players enriched-players.json]\ncontent-watch deliver\nCommon options: --state DIR --year 27 --platform ps5');return;}
 const dir=resolve(values.state??process.env.CONTENT_WATCH_STATE_DIR??'.content-watch');
 const storage=process.env.CONTENT_WATCH_STORE??(process.env.APP_DATABASE_URL?'database':'file');
 if(!['database','file'].includes(storage))throw new Error('CONTENT_WATCH_STORE must be database or file');
 if(storage==='database'&&!process.env.APP_DATABASE_URL)throw new Error('Database content watch requires APP_DATABASE_URL');
 if(storage==='database'&&process.env.APP_DATABASE_URL===process.env.PRICE_DATABASE_URL)throw new Error('Use a separate application database');
 const appPool=storage==='database'?new pg.Pool({connectionString:process.env.APP_DATABASE_URL,max:2,connectionTimeoutMillis:10000,statement_timeout:20000,application_name:'futbot-content-watch'}):undefined;
 let stopped=false;process.once('SIGINT',()=>{stopped=true;});process.once('SIGTERM',()=>{stopped=true;});
 let wake:(()=>void)|undefined;const signalStop=()=>wake?.();process.once('SIGINT',signalStop);process.once('SIGTERM',signalStop);
 const withState=async(work:(state:WatchState,save:()=>Promise<void>,metadata:WatchMetadata)=>Promise<void>)=>appPool?databaseWatch(appPool,year,work):withLock(dir,async()=>{const state=await loadState(dir,year);return work(state,()=>atomicJson(join(dir,'state.json'),state),{});});
 async function cycle(){await withState(async(state,save,metadata)=>{
  if(values.url){for(const url of values.url)if(!publicContentUrl(url))throw new Error('Unsupported public URL');state.publicUrls=[...new Set([...state.publicUrls,...values.url])];}
  let capture:Capture|undefined;
  if(command==='import'){
   if(Boolean(values.har)===Boolean(values.snapshot))throw new Error('Choose exactly one of --har or --snapshot');
   if(values.har)capture=readHar(JSON.parse(await readFile(values.har,'utf8')));
   else {const parsed=JSON.parse(await readFile(values.snapshot!,'utf8'));if(!Array.isArray(parsed.documents))throw new Error('Snapshot must contain documents');const docs=parsed.documents as Document[];
    // Collector files contain content documents only, never session headers.
    for(const d of docs){const u=new URL(d.url);if(u.protocol!=='https:'||!['www.ea.com','utas.mob.v1.prd.futc-ext.gcp.ea.com'].includes(u.hostname)||!Number.isFinite(Date.parse(d.capturedAt)))throw new Error('Invalid snapshot document');}
    capture=makeCapture(docs,[],parsed.capturedAt??new Date().toISOString());}
  }else if(command==='poll'||command==='watch'){
   if(!state.publicUrls.length)throw new Error('Import a startup HAR first, or supply --url with a supported public content URL');
   // A failed source aborts this scan; it does not replace state with an error page.
   const docs:Document[]=[];for(const url of state.publicUrls)docs.push(await fetchPublic(url));capture=makeCapture(docs,state.publicUrls);
  }
  if(capture){const fresh=Object.keys(state.records).length===0;const changes=applyCapture(state,capture,Boolean(values.baseline)||fresh);if(command==='poll'||command==='watch'){metadata.lastPublicPollAt=new Date().toISOString();metadata.lastPollError=null;}await save();console.log(JSON.stringify({definitions:Object.keys(state.records).length,changes:changes.length,baseline:Boolean(values.baseline)||fresh,coverage:state.coverage}));}
  queueUnreleased(state);await save();
  let players:Player[]=values.players?JSON.parse(await readFile(values.players,'utf8')):[];if(!Array.isArray(players))throw new Error('Player feed must be a JSON array');
  if(values.database){if(values.players)throw new Error('Choose --players or --database');if(!process.env.PRICE_DATABASE_URL)throw new Error('--database requires PRICE_DATABASE_URL');const repo=new PriceRepository(process.env.PRICE_DATABASE_URL,year);try{players=await readMarketPlayers(repo.pool,year,platform,maxAge);}finally{await repo.pool.end();}}
  if(!appPool){await writeFile(join(dir,'report.md'),report(state,players,platform,maxAge),{mode:0o600});}
  if(command==='deliver'||values.deliver){const userId=process.env.CONTENT_WATCH_USER_ID,token=process.env.DISCORD_TOKEN;if(!userId||!token)throw new Error('Private delivery requires CONTENT_WATCH_USER_ID and DISCORD_TOKEN');
   const pending=state.events.some(e=>!e.delivered&&isUnreleasedEvent(state,e));if(pending){const send=await discordSender(userId,token,players,state,platform,year,maxAge);console.log('Delivered '+await deliverPending(state,send,save)+' private alerts');}}
  console.log(appPool?'Content watch state saved in the application database.':'Report: '+join(dir,'report.md'));
 });}
 try{do{try{await cycle();}catch(e){if(command!=='watch')throw e;console.error('Content watch scan failed: '+(e instanceof Error?e.message:'unknown error'));}
  if(command!=='watch'||stopped)break;await new Promise<void>(done=>{const timer=setTimeout(done,interval*1000);wake=()=>{clearTimeout(timer);done();};});wake=undefined;
 }while(!stopped);}finally{await appPool?.end();}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))run().catch(e=>{console.error(e instanceof Error?e.message:'Content watch failed');process.exitCode=1;});
