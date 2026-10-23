import 'dotenv/config';
import pg from 'pg';
import {chromium,type BrowserContext,type Page} from 'playwright';
import {mkdir,chmod,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {encrypt,decrypt} from './auth.js';
import {browserAction,EA_VIEWPORT,type BrowserAction} from './ea-browser-control.js';
import {EACollector,collectionFailureMessage,EAAuthRequired,EARateLimited,EA_APP,UT_ORIGIN,allowedEAPage,browserInput} from './ea-browser-collector.js';
import {databaseWatch,WatchBusy} from './content-watch-store.js';
import {applyCapture} from './content-watch.js';
const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));
export function allowedUTRequest(method:string,path:string):boolean{
 if(['GET','HEAD','OPTIONS'].includes(method))return true;
 return method==='POST'&&(path==='/ut/auth'||/^\/ut\/game\/fc\d+\/(?:club|appstats)$/.test(path));
}
async function run(){
 const year=Number(process.env.GAME_YEAR??27),secret=process.env.SESSION_SECRET,interval=Number(process.env.EA_BROWSER_INTERVAL_SECONDS??900)*1000;
 if(!Number.isInteger(year)||year<20||year>99||!Number.isFinite(interval)||interval<300000)throw new Error('Use a valid game year and an interval of at least 300 seconds.');
 if(!process.env.APP_DATABASE_URL||process.env.APP_DATABASE_URL===process.env.PRICE_DATABASE_URL)throw new Error('Configure the existing separate APP_DATABASE_URL.');
 if(!secret||secret.length<32)throw new Error('Use the same SESSION_SECRET as the dashboard (32+ characters).');
 if(!/^\d{17,20}$/.test(process.env.CONTENT_WATCH_USER_ID??''))throw new Error('Configure CONTENT_WATCH_USER_ID.');
 const pool=new pg.Pool({connectionString:process.env.APP_DATABASE_URL,max:4,connectionTimeoutMillis:10000,statement_timeout:20000,application_name:'futbot-ea-browser'});
 pool.on('error',()=>console.error('EA browser database connection failed.'));
 const lease=await pool.connect();let hasLease=false,context:BrowserContext|undefined,page:Page|undefined,collector:EACollector|undefined,stopped=false,nextScan=0,lastFrame=0,lastBeat=0;
 const base=resolve(process.env.EA_BROWSER_PROFILE_DIR??'/data/ea-browser'),profile=join(base,'profile');
 const stop=()=>{stopped=true;void context?.close().catch(()=>{});};process.once('SIGTERM',stop);process.once('SIGINT',stop);
 lease.on('error',()=>{stopped=true;void context?.close().catch(()=>{});});
 let heartbeat:NodeJS.Timeout|undefined;
 const patch=async(values:{phase?:string;enabled?:boolean;error?:string|null;interactive?:boolean;clearFrame?:boolean;scanned?:boolean})=>{
  await pool.query(`UPDATE futbot_ea_browser SET phase=COALESCE($2,phase),auto_enabled=COALESCE($3,auto_enabled),
   last_error=$4,interactive_until=CASE WHEN $5::boolean IS TRUE THEN now()+interval '15 minutes' WHEN $5::boolean IS FALSE THEN NULL ELSE interactive_until END,
   frame_cipher=CASE WHEN $6 THEN NULL ELSE frame_cipher END,last_scan_at=CASE WHEN $7 THEN now() ELSE last_scan_at END,heartbeat_at=now() WHERE game_year=$1`,[year,values.phase??null,values.enabled??null,values.error??null,values.interactive??null,values.clearFrame??false,values.scanned??false]);
 };
 async function openBrowser(){
  await mkdir(profile,{recursive:true,mode:0o700});await chmod(base,0o700);await chmod(profile,0o700);
  context=await chromium.launchPersistentContext(profile,{headless:true,viewport:EA_VIEWPORT,serviceWorkers:'block',acceptDownloads:false});
  context.setDefaultTimeout(10000);context.setDefaultNavigationTimeout(20000);
  await context.route('**/*',async route=>{
   const r=route.request(),u=new URL(r.url());
   if(u.origin===UT_ORIGIN&&!allowedUTRequest(r.method(),u.pathname)){await route.abort();return;}
   if(r.isNavigationRequest()){
    let top=true;try{top=!r.frame().parentFrame();}catch{}
    if(top&&!allowedEAPage(r.url())){await route.abort();return;}
   }
   await route.continue();
  });
  collector=new EACollector(context,year);collector.observe();
  page=context.pages()[0]??await context.newPage();
  context.on('page',p=>{page=p;});
  context.on('close',()=>{if(!stopped)stopped=true;});
 }
 async function foreground(){if(!context)throw new Error('Browser unavailable.');if(!page||page.isClosed())page=context.pages().filter(p=>!p.isClosed()).at(-1)??await context.newPage();return page;}
 async function takeFrame(){
  const current=await foreground();if(!allowedEAPage(current.url()))throw new Error('Only EA pages may be shown.');
  const image=await current.screenshot({type:'jpeg',quality:65,timeout:8000});
  await pool.query("UPDATE futbot_ea_browser SET frame_cipher=$2,frame_at=now() WHERE game_year=$1 AND interactive_until>now()",[year,encrypt(image.toString('base64'),secret!)]);lastFrame=Date.now();
 }
 async function scan(){
  const cooldown=(await pool.query('SELECT rate_limit_until FROM futbot_ea_browser WHERE game_year=$1',[year])).rows[0]?.rate_limit_until;
  if(cooldown&&new Date(cooldown).getTime()>Date.now()){await patch({phase:'paused',enabled:false,error:'EA cooldown is active. Wait until the countdown finishes before checking again.'});return;}
  console.log('EA content check started.');
  await patch({phase:'checking'});
  try{
   let capture;
   try{capture=await collector!.scan();}catch(e){
    if(!(e instanceof EAAuthRequired)||stopped)throw e;
    // One normal page reload can renew an expired UT session using the saved login.
    // Verification prompts are left for the owner; no challenge bypass or login loop.
    collector!.clearSession();await (await foreground()).goto(EA_APP,{waitUntil:'domcontentloaded'});
    for(let n=0;n<30&&!collector!.hasSession()&&!stopped;n++)await pause(500);
    capture=await collector!.scan();
   }
   let saved=false;
   for(let i=0;i<4&&!saved;i++)try{
    await databaseWatch(pool,year,async(state,save,metadata)=>{const first=!Object.keys(state.records).length;const events=applyCapture(state,capture,first);metadata.lastAuthenticatedScanAt=new Date().toISOString();await save();console.log(`EA content check saved: ${events.length} changes; ${capture.coverage.evoFetched}/${capture.coverage.evoExpected} EVO definitions.`);});saved=true;
   }catch(e){if(!(e instanceof WatchBusy)||i===3)throw e;await pause(1000);}
   nextScan=Date.now()+interval;await patch({phase:'ready',enabled:true,scanned:true});
  }catch(e){
   nextScan=Date.now()+interval;
   if(e instanceof EAAuthRequired)await patch({phase:'needs_login',enabled:false,error:'EA requires login or verification. Open Connect EA to resume.'});
   else if(e instanceof EARateLimited){
    const until=new Date(Date.now()+e.retryAfterMs);
    await pool.query('UPDATE futbot_ea_browser SET rate_limit_until=$2 WHERE game_year=$1',[year,until]);
    console.error(`EA rate limit at ${e.endpoint}; checks paused until ${until.toISOString()}.`);
    await patch({phase:'paused',enabled:false,error:'EA rate limited the requests. Checks paused. Wait for the cooldown, then press Start / check now.'});
   }
   else {const detail=collectionFailureMessage(e);console.error('EA content check failed: '+detail);await patch({phase:'error',error:detail});}
  }
 }
 async function act(action:BrowserAction){
  if(action.action==='disconnect'){
   await patch({phase:'disconnected',enabled:false,interactive:false,clearFrame:true});
   collector?.clearSession();if(context){context.removeAllListeners('close');await context.close();context=undefined;}await rm(profile,{recursive:true,force:true});await openBrowser();return;
  }
  if(action.action==='pause'){await patch({phase:'paused',enabled:false});return;}
  if(action.action==='close'){await patch({phase:collector!.hasSession()?'ready':'needs_login',interactive:false,clearFrame:true});return;}
  const current=await foreground();
  if(action.action==='connect'||action.action==='reload'){
   await patch({phase:'login',enabled:false,interactive:true,clearFrame:true});collector!.clearSession();
   for(const other of context!.pages())if(other!==current)await other.close();await current.goto(EA_APP,{waitUntil:'domcontentloaded'});await takeFrame();return;
  }
  if(action.action==='scan'){
   await patch({interactive:false,clearFrame:true});await scan();return;
  }
  if(!allowedEAPage(current.url()))throw new Error('EA page required.');
  await browserInput(current,action);await patch({interactive:true,phase:collector!.hasSession()?'ready':'login'});await takeFrame();
 }
 try{
  hasLease=(await lease.query('SELECT pg_try_advisory_lock(428110,$1) AS locked',[year])).rows[0]?.locked===true;if(!hasLease)throw new Error('Another EA browser worker is already running.');
  await pool.query('INSERT INTO futbot_ea_browser(game_year) VALUES($1) ON CONFLICT DO NOTHING',[year]);
  await pool.query("UPDATE futbot_ea_browser_commands SET state='failed',payload_cipher=NULL,error='Browser restarted; repeat the action.',completed_at=now() WHERE game_year=$1 AND state IN ('pending','running')",[year]);
  await openBrowser();const row=(await pool.query('SELECT auto_enabled FROM futbot_ea_browser WHERE game_year=$1',[year])).rows[0];
  heartbeat=setInterval(()=>{void pool.query('UPDATE futbot_ea_browser SET heartbeat_at=now() WHERE game_year=$1',[year]).catch(()=>{});},5000);
  await patch({phase:row.auto_enabled?'login':'disconnected',interactive:false,clearFrame:true});
  if(row.auto_enabled){await (await foreground()).goto(EA_APP,{waitUntil:'domcontentloaded'}).catch(()=>{});nextScan=Date.now()+15000;}
  console.log('EA browser worker ready. Connect through the private Futbot dashboard.');
  while(!stopped){
   if(Date.now()-lastBeat>5000){await pool.query('UPDATE futbot_ea_browser SET heartbeat_at=now() WHERE game_year=$1',[year]);lastBeat=Date.now();}
   await pool.query("UPDATE futbot_ea_browser_commands SET state='failed',payload_cipher=NULL,error='Action expired. Try again.',completed_at=now() WHERE game_year=$1 AND state='pending' AND expires_at<=now()",[year]);
   const commands=await pool.query("UPDATE futbot_ea_browser_commands SET state='running' WHERE id=(SELECT id FROM futbot_ea_browser_commands WHERE game_year=$1 AND state='pending' AND expires_at>now() ORDER BY queued_at LIMIT 1) RETURNING *",[year]);
   if(commands.rows[0]){const command=commands.rows[0];try{
    const action=browserAction(JSON.parse(decrypt(command.payload_cipher,secret)));await act(action);
    await pool.query("UPDATE futbot_ea_browser_commands SET state='done',payload_cipher=NULL,completed_at=now() WHERE id=$1",[command.id]);
   }catch{await pool.query("UPDATE futbot_ea_browser_commands SET state='failed',payload_cipher=NULL,error='Browser action failed. Refresh the view and try again.',completed_at=now() WHERE id=$1",[command.id]);await patch({phase:'error',error:'Browser action failed. Refresh the view and try again.'});}}
   const state=(await pool.query('SELECT auto_enabled,interactive_until FROM futbot_ea_browser WHERE game_year=$1',[year])).rows[0];
   const interactive=state.interactive_until&&new Date(state.interactive_until).getTime()>Date.now();
   if(interactive&&Date.now()-lastFrame>2000)await takeFrame().catch(()=>{});
   if(!interactive){await pool.query('UPDATE futbot_ea_browser SET frame_cipher=NULL WHERE game_year=$1 AND frame_cipher IS NOT NULL',[year]);if(state.auto_enabled&&Date.now()>=nextScan)await scan();}
   await pool.query("DELETE FROM futbot_ea_browser_commands WHERE game_year=$1 AND completed_at<now()-interval '1 hour'",[year]);
   await pause(400);
  }
 }finally{
  stopped=true;if(heartbeat)clearInterval(heartbeat);await context?.close().catch(()=>{});
  if(hasLease){await patch({phase:'disconnected',clearFrame:true,interactive:false}).catch(()=>{});await lease.query('SELECT pg_advisory_unlock(428110,$1)',[year]).catch(()=>{});}lease.release();await pool.end();
 }
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))run().catch(()=>{console.error('EA browser worker stopped. Check browser installation, database configuration, shared SESSION_SECRET and profile volume.');process.exitCode=1;});
