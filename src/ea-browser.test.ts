import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {EACollector,EACollectionFailure,collectionFailureMessage,EAAuthRequired,EARateLimited,UT_ORIGIN,allowedEAPage,contentPath,browserInput} from './ea-browser-collector.js';
import {allowedUTRequest} from './ea-browser-worker.js';
import {browserAction,browserFrame,browserStatus,enqueueBrowserAction} from './ea-browser-control.js';
import {encrypt,decrypt,hash} from './auth.js';
import {definitions} from './content-watch.js';
import {testDatabase} from './test-db.js';
import {createWeb} from './web.js';
const owner='123456789012345678',other='987654321098765432',secret='s'.repeat(40);
async function collectorFixture(failStatus=0,emptySecondPage=false){
 const handlers:Record<string,Function>={},calls:any[]=[];let disposals=0;
 const context:any={on:(name:string,handler:Function)=>{handlers[name]=handler;},request:{get:async(url:string,options:any)=>{
  calls.push({url,options});let body:any;
  if(url.endsWith('/sbs/hub/v2'))body={categories:[{sets:[{setId:3,name:'SBC'}]}]};
  else if(url.includes('/sbs/setId/'))body={challenges:[{challengeId:4,setId:3,name:'Challenge',elgReq:[]}]};
  else if(url.endsWith('/academy/hub/v2'))body={categories:[{id:37,count:36,slotIds:Array.from({length:36},(_,i)=>i+1)}],slots:[]};
  else{const offset=Number(new URL(url).searchParams.get('offset'));body={slots:Array.from({length:offset?(emptySecondPage?0:16):20},(_,i)=>({id:offset+i+1,slotName:'EVO '+(offset+i),elgReqs:[],levels:[],randomPlayerPreview:{SECRET:'club'}}))};}
  return {status:()=>failStatus||200,ok:()=>!failStatus,json:async()=>body,dispose:async()=>{disposals++;}};
 }}};
 const collector=new EACollector(context,27,0);collector.observe();
 await handlers.response({url:()=>UT_ORIGIN+'/ut/auth',status:()=>200,json:async()=>({sid:'PRIVATE_SESSION'})});await new Promise(r=>setImmediate(r));
 return {collector,calls,disposals:()=>disposals};
}
test('automatic collector reads all EVO pages and only known GET content endpoints',async()=>{
 const {collector,calls,disposals}=await collectorFixture();const capture=await collector.scan();assert.deepEqual(capture.coverage,{evoExpected:36,evoFetched:36});assert.equal(calls.length,5);assert.equal(disposals(),5);
 assert.ok(calls.some(c=>c.url.includes('offset=20')));assert.ok(calls.every(c=>c.url.startsWith(UT_ORIGIN+'/ut/game/fc27/')&&c.options.maxRedirects===0&&c.options.headers['X-UT-SID']==='PRIVATE_SESSION'));
 assert.doesNotMatch(JSON.stringify(definitions(capture)),/PRIVATE_SESSION|SECRET|randomPlayerPreview/);
});
test('expired sessions pause collection without exporting or retaining the session header',async()=>{
 const f=await collectorFixture(401);await assert.rejects(f.collector.scan(),EAAuthRequired);assert.equal(f.collector.hasSession(),false);assert.equal(f.disposals(),1);await assert.rejects(f.collector.scan(),EAAuthRequired);assert.equal(f.calls.length,1);
});
test('rate limits and incomplete pages abort rather than produce partial snapshots',async()=>{
 const limited=await collectorFixture(429);await assert.rejects(limited.collector.scan(),EARateLimited);assert.equal(limited.calls.length,1);assert.equal(limited.disposals(),1);
 const partial=await collectorFixture(0,true);await assert.rejects(partial.collector.scan(),/Incomplete EVO page/);
});
test('navigation and UT write restrictions prevent trades, submissions and arbitrary URLs',()=>{
 assert.ok(allowedEAPage('https://accounts.ea.com/connect/auth'));assert.equal(allowedEAPage('https://ea.com.evil.test/'),false);assert.equal(allowedEAPage('file:///etc/passwd'),false);
 assert.ok(contentPath('/academy/category/37?offset=20&count=20'));assert.equal(contentPath('/store/purchase'),false);
 assert.ok(allowedUTRequest('POST','/ut/auth'));assert.ok(allowedUTRequest('POST','/ut/game/fc27/club'));assert.equal(allowedUTRequest('POST','/ut/game/fc27/sbs/challenge/4/submit'),false);assert.equal(allowedUTRequest('PUT','/ut/game/fc27/trade/4/bid'),false);
});
test('phone inputs reject arbitrary keys, URLs, oversized text and stale clicks',async()=>{
 assert.throws(()=>browserAction({action:'navigate',url:'https://evil.test'}));assert.throws(()=>browserAction({action:'click',x:2,y:0,frameAt:new Date().toISOString()}));assert.throws(()=>browserAction({action:'key',key:'Control+L'}));assert.throws(()=>browserAction({action:'text',text:'x'.repeat(1001)}));
 const calls:any[]=[];const page:any={mouse:{click:async(x:number,y:number)=>{calls.push([x,y]);}},keyboard:{insertText:async(text:string)=>{calls.push(text);}}};
 await browserInput(page,browserAction({action:'click',x:.5,y:.5,frameAt:new Date().toISOString()}));assert.deepEqual(calls[0],[500,380]);await assert.rejects(browserInput(page,{action:'click',x:.5,y:.5,frameAt:'2000-01-01T00:00:00Z'}),/expired/);
 await browserInput(page,browserAction({action:'text',text:'manual login'}));assert.equal(calls[1],'manual login');
});
test('browser commands and screenshots are encrypted and inaccessible when offline/expired',async()=>{
 const {pool,db}=await testDatabase();try{
  await assert.rejects(enqueueBrowserAction(pool,27,{action:'connect'},secret),/offline/);
  await pool.query("INSERT INTO futbot_ea_browser(game_year,phase,heartbeat_at,interactive_until,frame_cipher,frame_at) VALUES(27,'login',now(),now()+interval '15 minutes',$1,now())",[encrypt('test-jpeg',secret)]);
  const id=await enqueueBrowserAction(pool,27,browserAction({action:'text',text:'PRIVATE_PASSWORD'}),secret);
  const row=(await pool.query('SELECT * FROM futbot_ea_browser_commands WHERE id=$1',[id])).rows[0];assert.doesNotMatch(row.payload_cipher,/PRIVATE_PASSWORD/);assert.equal(JSON.parse(decrypt(row.payload_cipher,secret)).text,'PRIVATE_PASSWORD');
  const frame=await browserFrame(pool,27,secret);assert.equal(frame.image,'data:image/jpeg;base64,test-jpeg');assert.equal((await browserStatus(pool,27)).online,true);
  await pool.query("UPDATE futbot_ea_browser SET interactive_until=now()-interval '1 minute' WHERE game_year=27");assert.equal((await browserFrame(pool,27,secret)).image,null);await assert.rejects(enqueueBrowserAction(pool,27,{action:'text',text:'x'},secret),/connection screen/);
 }finally{await db.close();}
});
test('remote browser APIs enforce session, CSRF and the exact configured operator',async()=>{
 const {pool,db}=await testDatabase();Object.assign(process.env,{PUBLIC_URL:'http://127.0.0.1:3000',DISCORD_CLIENT_ID:'client',DISCORD_CLIENT_SECRET:'secret',DISCORD_TOKEN:'test',SESSION_SECRET:secret,CONTENT_WATCH_USER_ID:owner});
 for(const [token,id] of [['owner',owner],['other',other]])await pool.query("INSERT INTO futbot_sessions(session_hash,user_id,profile,token_cipher,csrf,expires_at) VALUES($1,$2,$3,$4,'csrf',now()+interval '1 hour')",[hash(token),id,{id},encrypt('access',secret)]);
 const server=createWeb({year:27} as any,{pool} as any,{platform:'ps5',maxAge:15} as any);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+(server.address() as any).port;
 try{
  const path='/api/content-watch/browser';assert.equal((await fetch(base+path)).status,401);assert.equal((await fetch(base+path+'/frame',{headers:{cookie:'futbot=other'}})).status,403);
  assert.equal((await fetch(base+path+'/command',{method:'POST',headers:{cookie:'futbot=owner','content-type':'application/json'},body:'{"action":"connect"}'})).status,403);
  const row=await fetch(base+path,{headers:{cookie:'futbot=owner'}});assert.equal(row.status,200);assert.equal(((await row.json()) as any).online,false);
 }finally{await new Promise<void>(r=>server.close(()=>r()));await db.close();}
});
test('phone connection panel escapes errors and offers controls without embedding EA in an iframe',async()=>{
 const dom=new JSDOM('<main></main>',{url:'https://futbot.test/app/',runScripts:'outside-only'});try{const w=dom.window as any;w.eval(await readFile(new URL('../dist/app/ea-browser.js',import.meta.url),'utf8'));w.document.querySelector('main').innerHTML=await w.FutbotEABrowser.render(async()=>({phase:'needs_login',online:true,last_error:'<script>bad()</script>'}));assert.equal(w.document.querySelectorAll('iframe,script').length,0);assert.match(w.document.querySelector('main').textContent,/Connect EA/);assert.ok(w.document.querySelector('#ea-type-form'));}finally{dom.window.close();}
});

test('collector reports safe HTTP and transport diagnostics without leaking response bodies or credentials',async()=>{
 const f=await collectorFixture(500);await assert.rejects(f.collector.scan(),e=>{
  assert.equal(collectionFailureMessage(e),'EA returned HTTP 500 at /sbs/hub/v2. The previous baseline is intact.');return true;
 });
 assert.doesNotMatch(collectionFailureMessage(new Error('PRIVATE_SESSION password=secret')),/PRIVATE_SESSION|password|secret/);
 assert.equal(collectionFailureMessage(new EACollectionFailure('Unexpected EVO hub response.')),'Unexpected EVO hub response.');
 const transport=await collectorFixture();(transport.collector as any).context.request.get=async()=>{throw new Error('Authorization PRIVATE_SESSION');};
 await assert.rejects(transport.collector.scan(),e=>{assert.match(collectionFailureMessage(e),/timed out at \/sbs\/hub\/v2/);assert.doesNotMatch(collectionFailureMessage(e),/Authorization|PRIVATE_SESSION/);return true;});
});
