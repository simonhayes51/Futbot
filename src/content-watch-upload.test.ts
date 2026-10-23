import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {readFile} from 'node:fs/promises';
import {JSDOM} from 'jsdom';
import {streamHar,contentWatchOperator} from './content-watch-upload.js';
import {applyCapture,definitions} from './content-watch.js';
import {databaseWatch,readDatabaseWatch,WatchBusy} from './content-watch-store.js';
import {testDatabase} from './test-db.js';
import {createWeb} from './web.js';
import {hash,encrypt} from './auth.js';
const owner='123456789012345678',other='987654321098765432';
function har(max=81,at='2026-10-23T07:20:00.000Z'){
 return {log:{entries:[{startedDateTime:at,request:{method:'GET',url:'https://utas.mob.v1.prd.futc-ext.gcp.ea.com/ut/game/fc27/academy/hub/v2',headers:[{name:'X-UT-SID',value:'SESSION_SECRET'}]},response:{status:200,content:{text:JSON.stringify({categories:[{slotIds:[1]}],slots:[{id:1,slotName:'Striker EVO',slotDescription:'A test',elgReqs:[{type:'PLAYER_ATTRIBUTE',eligibilitySlot:1,eligibilityValue:1},{type:'SCOPE',eligibilitySlot:1,eligibilityValue:1},{type:'ACADEMY_PLAYER_SLOTTING',eligibilitySlot:1,eligibilityValue:max}],levels:[],randomPlayerPreview:{private:'PRIVATE_CLUB'}}]})}}}]}};
}
const stream=(value:unknown)=>Readable.from([JSON.stringify(value)]);
test('streamed HAR handles tiny chunk boundaries and extracts only content',async()=>{
 const json=JSON.stringify(har()),c=await streamHar(Readable.from(Array.from(json)));assert.equal(definitions(c).length,1);assert.equal(c.coverage.evoFetched,1);const saved=JSON.stringify(definitions(c));assert.doesNotMatch(saved,/SESSION_SECRET|PRIVATE_CLUB|randomPlayerPreview/);
});
test('streamed import rejects truncated, irrelevant, excessive-depth and oversized input',async()=>{
 await assert.rejects(streamHar(Readable.from(['{"log":{"entries":['])),/Could not read/);
 await assert.rejects(streamHar(stream({log:{entries:[]}})),/No SBC or EVO/);
 await assert.rejects(streamHar(stream(har()),100),/smaller than 200/);
 await assert.rejects(streamHar(Readable.from(['['.repeat(140)+']'.repeat(140)])),/too deep/);
});
test('owner allowlist does not grant monitor access to arbitrary server admins',()=>{
 process.env.CONTENT_WATCH_USER_ID=owner;assert.ok(contentWatchOperator(owner));assert.equal(contentWatchOperator(other),false);delete process.env.CONTENT_WATCH_USER_ID;assert.equal(contentWatchOperator(owner),false);
});
test('dashboard uploads and worker read the same durable database baseline',async()=>{
 const {pool,db}=await testDatabase();try{
  const c=await streamHar(stream(har()));await databaseWatch(pool,27,async(state,save,meta)=>{applyCapture(state,c,true);meta.lastUploadMode='baseline';await save();});
  const loaded=await readDatabaseWatch(pool,27);assert.equal(loaded.state.records['evo:1'].definition.name,'Striker EVO');assert.equal(loaded.state.events.length,0);assert.equal(loaded.metadata.lastUploadMode,'baseline');
  await databaseWatch(pool,27,async(state,save,meta)=>{applyCapture(state,await streamHar(stream(har(82,'2026-10-23T07:21:00.000Z'))));meta.lastPublicPollAt='2026-10-23T07:22:00.000Z';await save();});
  const updated=await readDatabaseWatch(pool,27);assert.equal(updated.state.events.length,1);assert.equal(updated.metadata.lastPublicPollAt,'2026-10-23T07:22:00.000Z');assert.doesNotMatch(JSON.stringify(updated),/SESSION_SECRET|PRIVATE_CLUB/);
 }finally{await db.close();}
});
test('database busy lock rejects a second writer without releasing another writer lock',async()=>{
 let releases=0,unlocks=0;const pool:any={connect:async()=>({query:async(sql:string)=>{if(sql.includes('unlock'))unlocks++;return {rows:[{locked:false}]};},release(){releases++;}})};
 await assert.rejects(databaseWatch(pool,27,async()=>{}),WatchBusy);assert.equal(releases,1);assert.equal(unlocks,0);
});
test('upload API enforces login, CSRF and owner access, and invalid files leave baseline intact',async()=>{
 const {pool,db}=await testDatabase();Object.assign(process.env,{PUBLIC_URL:'http://127.0.0.1:3000',DISCORD_CLIENT_ID:'client',DISCORD_CLIENT_SECRET:'secret',DISCORD_TOKEN:'bot',SESSION_SECRET:'s'.repeat(40),CONTENT_WATCH_USER_ID:owner});
 for(const [token,id] of [['owner-token',owner],['other-token',other]])await pool.query('INSERT INTO futbot_sessions(session_hash,user_id,profile,token_cipher,csrf,expires_at) VALUES($1,$2,$3,$4,$5,now()+interval \'1 hour\')',[hash(token),id,{id,name:'User'},encrypt('access','s'.repeat(40)),'csrf']);
 const server=createWeb({year:27} as any,{pool} as any,{platform:'ps5',maxAge:15} as any);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+(server.address() as any).port;
 const headers={'Content-Type':'application/json','Origin':'http://127.0.0.1:3000','X-CSRF-Token':'csrf','Cookie':'futbot=owner-token'};
 try{
  assert.equal((await fetch(base+'/api/content-watch')).status,401);
  assert.equal((await fetch(base+'/api/content-watch',{headers:{Cookie:'futbot=other-token'}})).status,403);
  assert.equal((await fetch(base+'/api/content-watch/import',{method:'POST',headers:{...headers,'X-CSRF-Token':'bad'},body:JSON.stringify(har())})).status,403);
  assert.equal((await fetch(base+'/api/content-watch/import',{method:'POST',headers:{...headers,Cookie:'futbot=other-token'},body:JSON.stringify(har())})).status,403);
  const initial=await fetch(base+'/api/content-watch/import?mode=baseline',{method:'POST',headers,body:JSON.stringify(har())});assert.equal(initial.status,200);const data=await initial.json() as any;assert.equal(data.baseline,true);assert.equal(data.definitions,1);assert.equal(data.changes,0);
  const changed=await fetch(base+'/api/content-watch/import?mode=changes',{method:'POST',headers,body:JSON.stringify(har(82,'2026-10-23T07:21:00.000Z'))});assert.equal(changed.status,200);assert.equal(((await changed.json()) as any).changes,1);
  const invalid=await fetch(base+'/api/content-watch/import',{method:'POST',headers,body:'{"log":'});assert.equal(invalid.status,400);
  const current=await fetch(base+'/api/content-watch',{headers});const status=await current.json() as any;assert.equal(status.definitions,1);assert.equal(status.pendingAlerts,1);
  const content=await (await fetch(base+'/api/content-watch/report',{headers})).text();assert.match(content,/Striker EVO/);assert.doesNotMatch(content,/SESSION_SECRET|PRIVATE_CLUB/);
 }finally{await new Promise<void>(r=>server.close(()=>r()));await db.close();}
});
test('upload panel escapes imported names and sends selected file with CSRF',async()=>{
 const dom=new JSDOM('<main></main>',{url:'https://futbot.test/app/',runScripts:'outside-only'}),w=dom.window as any;
 try{
  w.eval(await readFile(new URL('../dist/app/content-watch.js',import.meta.url),'utf8'));
  const api=async()=>({ready:false,definitions:0,counts:{},metadata:{},coverage:null,publicSources:0,pendingAlerts:0,recent:[{name:'<img src=x onerror=alert(1)>',kind:'evo',type:'added',at:'2026-10-23T07:20:00Z'}]});
  w.document.querySelector('main').innerHTML=await w.FutbotContentWatchUpload.render(api);assert.equal(w.document.querySelectorAll('img').length,0);
  let sent:any,csrf='';class XHR{upload:any={};status=200;responseText=JSON.stringify({baseline:true,definitions:1,changes:0});onload:any;open(method:string,url:string){assert.equal(method,'POST');assert.equal(url,'/api/content-watch/import?mode=baseline');}setRequestHeader(key:string,value:string){if(key==='X-CSRF-Token')csrf=value;}send(file:any){sent=file;this.onload();}}
  w.XMLHttpRequest=XHR;let complete=false;w.FutbotContentWatchUpload.bind('the-csrf',()=>{complete=true;});const form=w.document.querySelector('form'),file=new w.File(['{}'],'capture.har',{type:'application/json'});Object.defineProperty(form.elements.har,'files',{value:[file]});form.dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));assert.equal(sent,file);assert.equal(csrf,'the-csrf');assert.equal(complete,true);
 }finally{dom.window.close();}
});
test('dashboard owner sees and can open the private upload page',async()=>{
 const dom=new JSDOM(await readFile(new URL('../dist/app/index.html',import.meta.url),'utf8'),{url:'https://futbot.test/app/',runScripts:'outside-only'}),w=dom.window as any;
 try{
  w.fetch=async(url:string)=>{const endpoint=url.replace('/api/','').split('?')[0];let data:any={};
   if(endpoint==='me')data={user:{id:owner,name:'Simon'},csrf:'token',year:27,platform:'ps5',contentWatchOperator:true};
   if(endpoint==='market')data={freshCards:0,fodder:[],risers:[],fallers:[]};
   if(endpoint==='alerts')data={alerts:[]};if(endpoint==='watchlist')data={cards:[]};if(endpoint==='investments')data={holdings:[]};if(endpoint==='guilds')data={guilds:[]};
   if(endpoint==='content-watch')data={ready:false,definitions:0,metadata:{},coverage:null,publicSources:0,pendingAlerts:0,recent:[]};
   return {ok:true,status:200,json:async()=>data};};
  w.eval(await readFile(new URL('../dist/app/content-watch.js',import.meta.url),'utf8'));w.eval(await readFile(new URL('../dist/app/live.js',import.meta.url),'utf8'));
  await new Promise(r=>setTimeout(r,30));const button=w.document.querySelector('#content-watch-nav');assert.equal(button.hidden,false);button.click();await new Promise(r=>setTimeout(r,30));assert.ok(w.document.querySelector('#content-upload-form'));assert.match(w.document.querySelector('#main').textContent,/Upload your HAR/);
 }finally{dom.window.close();}
});
