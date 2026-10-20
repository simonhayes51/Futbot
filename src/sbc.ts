export type SbcChoice = {name:string;url:string;description:string};
export type SbcGroup = {overall:number;rarity:number;count:number;price:number;score:number;unitPrice:number;unitScore:number};
export type SbcRoute = {key:string;price:number;score:number;cards:number;groups:SbcGroup[]};
export type SbcChallenge = {id:number|null;scoreRequirement:number|null;name:string;description:string;requirements:string[];reward:string;expires:string|null;price:number|null;routes:SbcRoute[];solutionUrl:string|null;streamlined:boolean};
export type SbcDetail = {name:string;description:string;expires:string|null;repeatable:string|null;challenges:SbcChallenge[];url:string};
const ROOT='https://www.fut.gg';
const text=(s:string)=>s.replace(/<[^>]*>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&#x2F;/g,'/').replace(/\s+/g,' ').trim();
function quoted(s:string,key:string):string|null{const m=new RegExp(`(?:^|[,{}])\\s*${key}:\\s*`).exec(s);if(!m)return null;const start=m.index+m[0].length,q=s[start];if(q!=='"'&&q!=="'")return null;let escaped=false;for(let i=start+1;i<s.length;i++){if(escaped){escaped=false;continue;}if(s[i]==='\\'){escaped=true;continue;}if(s[i]===q){const raw=s.slice(start,i+1);try{return q==='"'?JSON.parse(raw):raw.slice(1,-1).replace(/\\'/g,"'").replace(/\\\\/g,'\\');}catch{return raw.slice(1,-1);}}}return null;}
function number(s:string,key:string):number|null{const m=s.match(new RegExp(`(?:^|[,{}])\\s*${key}:\\s*(-?\\d+(?:\\.\\d+)?)`));return m?Number(m[1]):null;}
function bool(s:string,key:string):boolean{return new RegExp(`(?:^|[,{}])\\s*${key}:\\s*!0`).test(s);}
function stringArray(s:string,key:string):string[]{const m=s.match(new RegExp(`${key}:\\$R\\[\\d+\\]=\\[([^\\]]*)\\]`));if(!m)return[];const out:string[]=[];for(const q of m[1].matchAll(/"((?:\\.|[^"\\])*)"/g)){try{out.push(JSON.parse(`"${q[1]}"`));}catch{}}return out;}
function arrayObjects(s:string,marker:string):string[]{const at=s.indexOf(marker);if(at<0)return[];const open=s.indexOf('[',at);if(open<0)return[];let depth=0,braces=0,start=-1,quote='',escape=false;const result:string[]=[];for(let i=open;i<s.length;i++){const c=s[i];if(quote){if(escape)escape=false;else if(c==='\\')escape=true;else if(c===quote)quote='';continue;}if(c==='"'||c==="'"){quote=c;continue;}if(c==='['){depth++;continue;}if(c===']'){depth--;if(depth===0)break;continue;}if(c==='{'){if(depth===1&&braces===0)start=i;braces++;continue;}if(c==='}'&&braces>0){braces--;if(depth===1&&braces===0&&start>=0){result.push(s.slice(start,i+1));start=-1;}}}return result;}
function routeGroups(route:string):SbcGroup[]{return [...route.matchAll(/overall:(\d+),rarityEaId:(\d+),count:(\d+),price:(\d+),score:(\d+),unitPrice:(\d+),unitScore:(\d+)/g)].map(m=>({overall:+m[1],rarity:+m[2],count:+m[3],price:+m[4],score:+m[5],unitPrice:+m[6],unitScore:+m[7]}));}
function balancedArray(s:string,at:number):string{const assign=s.indexOf(']=',at),open=s.indexOf('[',assign>=0?assign+2:at);if(open<0)return'';let depth=0,quote='',escape=false;for(let i=open;i<s.length;i++){const c=s[i];if(quote){if(escape)escape=false;else if(c==='\\')escape=true;else if(c===quote)quote='';continue;}if(c==='"'||c==="'"){quote=c;continue;}if(c==='[')depth++;else if(c===']'&&--depth===0)return s.slice(open,i+1);}return'';}
function currentExpiry(value:string|null):string|null{if(!value)return null;const time=Date.parse(value);if(!Number.isFinite(time))return value;const now=Date.now();return time>now+2*366*24*60*60_000?null:value;}
function routesFor(block:string,platform:'ps5'|'pc'):SbcRoute[]{const marketAt=block.indexOf(`${platform}:`);if(marketAt<0)return[];const market=block.slice(marketAt);const at=market.indexOf('routes:');const raw=at>=0?balancedArray(market,at):'';return arrayObjects(raw,'').map(obj=>({key:quoted(obj,'key')??'route',price:number(obj,'price')??0,score:number(obj,'score')??0,cards:number(obj,'cards')??0,groups:routeGroups(obj)})).filter(route=>route.price>0&&route.cards>0&&route.groups.length).sort((a,b)=>a.price-b.price);}
export function parseSbcList(html:string):SbcChoice[]{const choices:SbcChoice[]=[],seen=new Set<string>();for(const m of html.matchAll(/<a\b[^>]*href="(\/sbc\/(?!category\/|streamlined-solver\/)[^"]+\/)"[^>]*>([\s\S]*?)<\/a>/gi)){const url=m[1].split('?')[0];if(seen.has(url))continue;const body=m[2];const title=body.match(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/i)?.[1];if(!title)continue;const name=text(title);if(!name||name.length>100)continue;const description=text(body.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1]??'');seen.add(url);choices.push({name,url,description:description.slice(0,180)});}return choices;}
export function parseSbcDetail(html:string,url:string,platform:'ps5'|'pc'='ps5'):SbcDetail{
 const fallbackTitle=text(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]??'').replace(/\s*[-|·].*$/,'')||'SBC';
 const path=url.replace(/^https?:\/\/www\.fut\.gg/,'').split('?')[0];const anchor=html.toLowerCase().indexOf(`url:"${path}"`.toLowerCase());const set=anchor>=0?html.slice(Math.max(0,anchor-4000),anchor+16000):html;
 const title=quoted(set,'name')??fallbackTitle;
 const description=quoted(set,'description')??text(html.match(/<meta\s+name="description"\s+content="([^"]*)"/i)?.[1]??'');
 const expires=currentExpiry(quoted(set,'endTime')??quoted(set,'expiresAt'));const expiresIn=quoted(set,'expiresIn');const repeat=quoted(set,'repeatRefreshIntervalText');
 const setRewards=[...new Set([...set.matchAll(/pack:"((?:\\.|[^"\\])*)"/g)].flatMap(m=>{try{return[JSON.parse(`"${m[1]}"`)]}catch{return[]}}))];
 const challengeArray=balancedArray(set,set.indexOf('challenges:'));const challengeRows=arrayObjects(challengeArray,'');
 const challenges=challengeRows.map(row=>{
  const names=quoted(row,'name')??'Challenge';const desc=quoted(row,'description')??'';const req=stringArray(row,'requirementsText');
  const rewards=[...new Set([...row.matchAll(/pack:"((?:\\.|[^"\\])*)"/g)].flatMap(m=>{try{return[JSON.parse(`"${m[1]}"`)]}catch{return[]}}))];
  const solutionPath=quoted(row,'cheapestSolutionUrl');const regularPrice=number(row,'cheapestSolutionPrice');
  const challengeId=number(row,'eaId');const isStreamlined=bool(row,'isStreamlined');let routes:SbcRoute[]=[];let bestPrice=regularPrice;
  if(isStreamlined&&challengeId){
   // Solver payloads can contain a route for every challenge in the SBC set.
   // Match challengeEaId first; reading the first platform route can attach a
   // full-set (100+ card) total to a single challenge.
   const streamAt=set.indexOf('streamlinedSolutions:');const stream=streamAt>=0?set.slice(streamAt):'';const challengesAt=stream.indexOf('challenges:');
   const challengeData=challengesAt>=0?balancedArray(stream,challengesAt):'';const rows=arrayObjects(challengeData,'');const match=rows.find(item=>number(item,'challengeEaId')===challengeId);
   routes=routesFor(match??'',platform);
   // Older FUT.GG payloads have one challenge and put routes directly under
   // the solver object. Preserve that format, but never surface a full-set
   // route as if it were one squad.
   if(!routes.length&&!rows.length)routes=routesFor(stream,platform);
   routes=routes.filter(route=>route.cards<=11&&route.groups.reduce((sum,g)=>sum+g.count,0)===route.cards);
   if(routes[0])bestPrice=routes[0].price;
  }
  return{id:challengeId,scoreRequirement:number(row,'scoreRequirement'),name:names,description:desc,requirements:req,reward:(rewards.length?rewards:setRewards).join(', '),expires,price:bestPrice,routes,solutionUrl:solutionPath?ROOT+solutionPath:null,streamlined:isStreamlined};
 }).filter(c=>c.name!=='Challenge');
 return{name:title,description,expires:expires??expiresIn,repeatable:repeat,challenges,url:ROOT+path};
}
async function get(url:string,fetcher:typeof fetch):Promise<string>{const r=await fetcher(url,{headers:{'user-agent':'FutBot/1.0 (SBC info)','accept':'text/html'},signal:AbortSignal.timeout(15_000)});if(!r.ok)throw new Error(`FUT.GG returned HTTP ${r.status}`);return r.text();}
const listCache=new Map<number,{until:number;value:Promise<SbcChoice[]>}>();const detailCache=new Map<string,{until:number;value:Promise<SbcDetail>}>();
export function fetchSbcList(year:number,fetcher:typeof fetch=fetch):Promise<SbcChoice[]>{const hit=listCache.get(year);if(hit&&hit.until>Date.now())return hit.value;const value=get(`${ROOT}/sbc/`,fetcher).then(parseSbcList).catch(e=>{listCache.delete(year);throw e});listCache.set(year,{until:Date.now()+5*60_000,value});return value;}
export function fetchSbcDetail(url:string,fetcher:typeof fetch=fetch,platform:'ps5'|'pc'='ps5'):Promise<SbcDetail>{const canonical=url.startsWith('/sbc/')?ROOT+url:url;if(!/^https:\/\/www\.fut\.gg\/sbc\/[a-z0-9/-]+\/$/.test(canonical))throw new Error('Choose an SBC from the autocomplete list.');const key=`${canonical}:${platform}`,hit=detailCache.get(key);if(hit&&hit.until>Date.now())return hit.value;const value=get(canonical,fetcher).then(html=>parseSbcDetail(html,canonical,platform)).catch(e=>{detailCache.delete(key);throw e});detailCache.set(key,{until:Date.now()+2*60_000,value});return value;}

export type SolvedPlayer={name:string;overall:number;rarity:string;price:number};
export async function fetchSbcPlayers(url:string,challenge:SbcChallenge,route:SbcRoute,platform:'ps5'|'pc',fetcher:typeof fetch=fetch):Promise<SolvedPlayer[]>{
 if(!challenge.id||!route.groups.length)return[];
 const game=url.match(/\/(\d{2})-[^/]+\/$/)?.[1]??'27';
 const slug=url.replace(/\/$/,'').split('/').pop()??'';
 const groups=await Promise.all(route.groups.map(async group=>{
  const endpoint=`${ROOT}/api/fut/sbc/${game}/${slug}/streamlined-solutions/?challenge=${challenge.id}&overall=${group.overall}&rarity=${group.rarity}&platform=${platform}&limit=30`;
  const response=await fetcher(endpoint,{headers:{accept:'application/json','user-agent':'FutBot/1.0 (SBC solver)'},signal:AbortSignal.timeout(12_000)});
  if(!response.ok)return[];const payload=await response.json() as any;const rows=Array.isArray(payload?.data?.players)?payload.data.players:[];
  const candidates=rows.flatMap((row:any)=>{const p=row?.player;const name=String(p?.commonName||p?.cardName||p?.firstName||'').trim();const overall=Number(p?.overall),price=Number(row?.price),score=Number(row?.gradingScore);return name&&overall===group.overall&&price>0&&score===group.unitScore?[{id:String(p.eaId??p.id),name,overall,rarity:String(p.rarityName||'Player item'),price}]:[];}).sort((a:any,b:any)=>a.price-b.price);
  const chosen=[] as SolvedPlayer[];const ids=new Set<string>();for(const player of candidates){if(ids.has(player.id))continue;ids.add(player.id);chosen.push(player);if(chosen.length>=group.count)break;}
  return chosen;
 }));
 return groups.flat();
}

export async function fetchSbcSolutionNames(url:string,fetcher:typeof fetch=fetch,resolve:(eaId:string)=>Promise<string|null>=async()=>null):Promise<string[]>{
 if(!/^https:\/\/www\.fut\.gg\/\d{2}\/squad-builder\/[a-f0-9-]+\/$/i.test(url))return[];
 const uuid=url.match(/\/squad-builder\/([a-f0-9-]+)\/$/i)?.[1];if(!uuid)return[];
 const response=await fetcher(`${ROOT}/api/squads/${uuid}/`,{headers:{'user-agent':'FutBot/1.0 (SBC squad solution)','accept':'application/json','referer':url},signal:AbortSignal.timeout(15_000)});
 if(!response.ok)throw new Error(`FUT.GG squad API returned HTTP ${response.status}`);
 const payload=await response.json() as any;
 const positions=payload?.data?.data?.activeGroupPositions;
 if(!Array.isArray(positions))return[];
 const players=positions.filter((p:any)=>p?.group==='FIELD'&&/^\d+$/.test(String(p.playerEaId??''))).sort((a:any,b:any)=>Number(a.positionIdx)-Number(b.positionIdx)).slice(0,11);
 return Promise.all(players.map(async(p:any)=>{
  const id=String(p.playerEaId);
  try{
   const name=await resolve(id);
   return name?.trim()?name.trim():`Unknown card (${id})`;
  }catch{
   return `Unknown card (${id})`;
  }
 }));
}
