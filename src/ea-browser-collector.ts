import type {BrowserContext,Page} from 'playwright';
import {makeCapture,readHar,publicContentUrl,type Capture,type Document} from './content-watch.js';
export const EA_APP='https://www.ea.com/ea-sports-fc/ultimate-team/web-app/';
export const UT_ORIGIN='https://utas.mob.v1.prd.futc-ext.gcp.ea.com';
export class EAAuthRequired extends Error{}
export class EARateLimited extends Error{}
export function allowedEAPage(value:string):boolean{try{const u=new URL(value);return u.protocol==='https:'&&(u.hostname==='ea.com'||u.hostname.endsWith('.ea.com'))&&!u.username&&!u.password;}catch{return value==='about:blank';}}
export function contentPath(path:string):boolean{return /^\/(?:sbs\/(?:hub\/v2|setId\/\d+\/challenges)|academy\/(?:hub\/v2|category\/\d+))$/.test(path.split('?')[0]);}
export class EACollector{
 private sid:string|undefined;
 private publicDocuments=new Map<string,Document>();
 constructor(private context:BrowserContext,readonly year:number,private delayMs=500){}
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
  const documents:Document[]=[];let requests=0;const deadline=Date.now()+90000;
  const get=async(path:string):Promise<any>=>{
   if(!contentPath(path)||++requests>250||Date.now()>=deadline)throw new Error('Content request limit exceeded.');
   if(this.delayMs)await new Promise(r=>setTimeout(r,this.delayMs));
   const url=UT_ORIGIN+`/ut/game/fc${this.year}`+path;
   const response=await this.context.request.get(url,{headers:{'X-UT-SID':this.sid!,accept:'application/json',origin:'https://www.ea.com',referer:EA_APP},maxRedirects:0,timeout:Math.max(1,Math.min(15000,deadline-Date.now()))});
   try{
   if([401,403,458,459,460,461].includes(response.status())){this.clearSession();throw new EAAuthRequired('EA requires login or verification.');}
   if(response.status()===429)throw new EARateLimited('EA rate limit. Automatic checks are paused.');
   if(!response.ok())throw new Error('EA content request failed.');
   const body=await response.json();documents.push({url:url.split('?')[0],capturedAt:new Date().toISOString(),body});return body;
   }finally{await response.dispose();}
  };
  const hub=await get('/sbs/hub/v2');if(!Array.isArray(hub.categories))throw new Error('Unexpected SBC hub response.');
  const ids=new Set<number>();for(const c of hub.categories)for(const s of c.sets??[]){if(!Number.isSafeInteger(s.setId)||s.setId<=0)throw new Error('Unexpected SBC set ID.');ids.add(s.setId);}
  for(const id of ids){const b=await get(`/sbs/setId/${id}/challenges`);if(!Array.isArray(b.challenges))throw new Error('Unexpected SBC challenge response.');}
  const evos=await get('/academy/hub/v2');if(!Array.isArray(evos.categories)||!Array.isArray(evos.slots))throw new Error('Unexpected EVO hub response.');
  for(const c of evos.categories){
   if(!Number.isSafeInteger(c.id)||c.id<0||!Number.isSafeInteger(c.count)||c.count<0||c.count>1000)throw new Error('Unexpected EVO category.');
   const seen=new Set<number>();
   for(let offset=0;offset<c.count;offset+=20){const b=await get(`/academy/category/${c.id}?offset=${offset}&count=20&sortOrder=asc&slotStatus=NOT_STARTED`);
    if(!Array.isArray(b.slots)||!b.slots.length)throw new Error('Incomplete EVO page.');
    for(const s of b.slots){if(!Number.isSafeInteger(s.id)||seen.has(s.id))throw new Error('Repeated or invalid EVO page.');seen.add(s.id);}
   }
   if(seen.size<c.count)throw new Error('Incomplete EVO category.');
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
