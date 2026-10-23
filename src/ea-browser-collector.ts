import type {BrowserContext,Page} from 'playwright';
import {makeCapture,readHar,publicContentUrl,type Capture,type Document} from './content-watch.js';
export const EA_APP='https://www.ea.com/ea-sports-fc/ultimate-team/web-app/';
export const UT_ORIGIN='https://utas.mob.v1.prd.futc-ext.gcp.ea.com';
export class EACollectionFailure extends Error{}
// Only errors constructed here may reach logs or the dashboard. Never forward
// Playwright/HTTP/SQL messages: they can contain headers, URLs or credentials.
export function collectionFailureMessage(error:unknown):string{
 return error instanceof EACollectionFailure?error.message:'Content check failed while saving data or refreshing the EA session. The previous baseline is intact.';
}
export class EAAuthRequired extends Error{}
export function retryAfterDelay(value:string|undefined,now=Date.now()):number{
 const numeric=value&&/^\d+(?:\.\d+)?$/.test(value.trim())?Number(value)*1000:NaN;
 const delay=Number.isFinite(numeric)?numeric:Date.parse(value??'')-now;
 // No EA-specific reset window is known. Use a conservative 30-minute fallback.
 return Number.isFinite(delay)&&delay>=0&&delay<8.64e15-now?Math.max(60000,delay):1800000;
}
export class EARateLimited extends Error{
 constructor(readonly retryAfterMs=1800000,readonly endpoint='content'){super('EA rate limit. Automatic checks are paused.');}
}
export function allowedEAPage(value:string):boolean{try{const u=new URL(value);return u.protocol==='https:'&&(u.hostname==='ea.com'||u.hostname.endsWith('.ea.com'))&&!u.username&&!u.password;}catch{return value==='about:blank';}}
export function contentPath(path:string):boolean{return /^\/(?:sbs\/(?:hub\/v2|setId\/\d+\/challenges)|academy\/(?:hub\/v2|category\/\d+))$/.test(path.split('?')[0]);}
export class EACollector{
 private sid:string|undefined;
 private publicDocuments=new Map<string,Document>();
 constructor(private context:BrowserContext,readonly year:number,private delayMs=1500){}
 observe():void{
  this.context.on('request',request=>{void(async()=>{
   const url=new URL(request.url());if(url.origin!==UT_ORIGIN||!url.pathname.startsWith(`/ut/game/fc${this.year}/`))return;
   const sid=await request.headerValue('x-ut-sid');if(sid)this.sid=sid;
  })().catch(()=>{});});
  this.context.on('response',response=>{void(async()=>{
   const u=new URL(response.url());if(response.status()!==200)return;
   if(u.origin===UT_ORIGIN&&u.pathname==='/ut/auth'){const body=await response.json();if(typeof body.sid==='string')this.sid=body.sid;return;}
   if(publicContentUrl(u.origin+u.pathname)){
    const text=await response.text();const c=readHar({log:{entries:[{startedDateTime:new Date().toISOString(),request:{method:'GET',url:u.origin+u.pathname},response:{status:200,content:{text}}}]}},true);
    for(const d of c.documents)this.publicDocuments.set(d.url,d);
   }
  })().catch(()=>{});});
 }
 hasSession():boolean{return Boolean(this.sid);}
 clearSession():void{this.sid=undefined;}
 async scan():Promise<Capture>{
  if(!this.sid)throw new EAAuthRequired('Reconnect to EA to resume content checks.');
  const documents:Document[]=[];let requests=0;const deadline=Date.now()+180000;
  const get=async(path:string):Promise<any>=>{
   if(!contentPath(path)||++requests>250||Date.now()>=deadline)throw new EACollectionFailure('Content scan exceeded its 180-second or 250-request limit. The previous baseline is intact.');
   const label=path.split('?')[0];
   if(this.delayMs)await new Promise(r=>setTimeout(r,this.delayMs));
   const url=UT_ORIGIN+`/ut/game/fc${this.year}`+path;
   let response;try{response=await this.context.request.get(url,{headers:{'X-UT-SID':this.sid!,accept:'application/json',origin:'https://www.ea.com',referer:EA_APP},maxRedirects:0,timeout:Math.max(1,Math.min(15000,deadline-Date.now()))});}catch{throw new EACollectionFailure(`EA request failed or timed out at ${label}. The previous baseline is intact.`);}
   try{
   if([401,403,458,459,460,461].includes(response.status())){this.clearSession();throw new EAAuthRequired('EA requires login or verification.');}
   if(response.status()===429)throw new EARateLimited(retryAfterDelay(response.headers()['retry-after']),label);
   if(!response.ok())throw new EACollectionFailure(`EA returned HTTP ${response.status()} at ${label}. The previous baseline is intact.`);
   let body;try{body=await response.json();}catch{throw new EACollectionFailure(`EA returned invalid JSON at ${label}. The previous baseline is intact.`);}documents.push({url:url.split('?')[0],capturedAt:new Date().toISOString(),body});return body;
   }finally{await response.dispose();}
  };
  const hub=await get('/sbs/hub/v2');if(!Array.isArray(hub.categories))throw new EACollectionFailure('Unexpected SBC hub response. The previous baseline is intact.');
  const ids=new Set<number>();for(const c of hub.categories)for(const s of c.sets??[]){if(!Number.isSafeInteger(s.setId)||s.setId<=0)throw new EACollectionFailure('Unexpected SBC set ID. The previous baseline is intact.');ids.add(s.setId);}
  for(const id of ids){const b=await get(`/sbs/setId/${id}/challenges`);if(!Array.isArray(b.challenges))throw new EACollectionFailure('Unexpected SBC challenge response. The previous baseline is intact.');}
  const evos=await get('/academy/hub/v2');if(!Array.isArray(evos.categories)||!Array.isArray(evos.slots))throw new EACollectionFailure('Unexpected EVO hub response. The previous baseline is intact.');
  for(const c of evos.categories){
   if(!Number.isSafeInteger(c.id)||c.id<0||!Number.isSafeInteger(c.count)||c.count<0||c.count>1000)throw new EACollectionFailure('Unexpected EVO category. The previous baseline is intact.');
   const seen=new Set<number>();
   for(let offset=0;offset<c.count;offset+=20){const b=await get(`/academy/category/${c.id}?offset=${offset}&count=20&sortOrder=asc&slotStatus=NOT_STARTED`);
    if(!Array.isArray(b.slots)||!b.slots.length)throw new EACollectionFailure('Incomplete EVO page. The previous baseline is intact.');
    for(const s of b.slots){if(!Number.isSafeInteger(s.id)||seen.has(s.id))throw new EACollectionFailure('Repeated or invalid EVO page. The previous baseline is intact.');seen.add(s.id);}
   }
   if(seen.size<c.count)throw new EACollectionFailure('Incomplete EVO category. The previous baseline is intact.');
  }
  documents.push(...this.publicDocuments.values());const capture=makeCapture(documents,[...this.publicDocuments.keys()]);this.publicDocuments.clear();return capture;
 }
}
export async function browserInput(page:Page,action:import('./ea-browser-control.js').BrowserAction):Promise<void>{
 if(action.action==='click'){
  const age=Date.now()-Date.parse(action.frameAt!);if(!Number.isFinite(age)||age< -1000||age>20000)throw new Error('Browser image expired. Refresh before tapping.');
  await page.mouse.click(action.x!*1000,action.y!*760);
 }else if(action.action==='text')await page.keyboard.insertText(action.text!);
 else if(action.action==='key')await page.keyboard.press(action.key!);
 else if(action.action==='scroll')await page.mouse.wheel(0,action.delta!);
}
