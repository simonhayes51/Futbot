import {createHash,randomBytes,createCipheriv,createDecipheriv,timingSafeEqual,createHmac} from 'node:crypto';
export const randomToken=()=>randomBytes(32).toString('base64url');
export const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
export function same(a:string,b:string){const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);}
export function encrypt(value:string,secret:string){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',createHash('sha256').update(secret).digest(),iv);return [iv.toString('base64url'),Buffer.concat([c.update(value,'utf8'),c.final()]).toString('base64url'),c.getAuthTag().toString('base64url')].join('.');}
export function decrypt(value:string,secret:string){const [iv,data,tag]=value.split('.');const c=createDecipheriv('aes-256-gcm',createHash('sha256').update(secret).digest(),Buffer.from(iv,'base64url'));c.setAuthTag(Buffer.from(tag,'base64url'));return Buffer.concat([c.update(Buffer.from(data,'base64url')),c.final()]).toString('utf8');}
export function signState(value:string,secret:string){return value+'.'+createHmac('sha256',secret).update(value).digest('base64url');}
export function validState(value:string,secret:string){const [v,sig]=value.split('.');return !!v&&!!sig&&same(signState(v,secret),value);}
export function canManage(guild:{owner?:boolean;permissions?:string}){try{const p=BigInt(guild.permissions??'0');return guild.owner===true||(p&8n)!==0n||(p&32n)!==0n;}catch{return false;}}
export class HttpError extends Error{constructor(public status:number,message:string){super(message);}}
const discordReads=new Map<string,{until:number;value:any}>();
const pendingReads=new Map<string,Promise<any>>();
const cooldowns=new Map<string,number>();
const pause=(ms:number)=>new Promise(r=>setTimeout(r,ms));
export async function discord(path:string,token:string,method='GET',body?:unknown,bearer=false,fresh=false):Promise<any>{
 const identity=hash((bearer?'user:':'bot:')+token),key=identity+':'+method+':'+path;
 const cached=discordReads.get(key);if(method==='GET'&&!fresh&&cached&&cached.until>Date.now())return cached.value;
 if(method==='GET'&&pendingReads.has(key))return pendingReads.get(key)!;
 async function request(){
 for(let attempt=0;attempt<2;attempt++){
 const wait=Math.max(cooldowns.get(key)??0,cooldowns.get(identity)??0)-Date.now();
 if(wait>20000)throw new HttpError(429,`Discord rate limit: try again in ${Math.ceil(wait/1000)} seconds.`);
 if(wait>0)await pause(wait);
 const r=await fetch('https://discord.com/api/v10'+path,{method,headers:{Authorization:`${bearer?'Bearer':'Bot'} ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(12000)});
 if(r.headers.get('X-RateLimit-Remaining')==='0'){const reset=Number(r.headers.get('X-RateLimit-Reset-After'));if(Number.isFinite(reset)&&reset>0)cooldowns.set(key,Date.now()+reset*1000+50);}
 if(r.status===429){const data=await r.json().catch(()=>({})) as any;const seconds=Number(r.headers.get('Retry-After')??data.retry_after??1);const delay=Number.isFinite(seconds)&&seconds>=0?seconds*1000+50:1000;cooldowns.set(data.global?identity:key,Date.now()+delay);if(attempt===0&&delay<=20000)continue;throw new HttpError(429,`Discord rate limit: try again in ${Math.ceil(delay/1000)} seconds.`);}
 if(!r.ok)throw new HttpError(r.status===401?401:r.status===404?404:502,r.status===401?'Your Discord session expired. Sign in again.':'Discord could not complete this request. Check bot membership and permissions.');
 const value=r.status===204?null:await r.json();if(method==='GET')discordReads.set(key,{until:Date.now()+10000,value});
 if(discordReads.size>1000)for(const [k,v]of discordReads)if(v.until<Date.now())discordReads.delete(k);if(discordReads.size>2000)discordReads.clear();
 if(cooldowns.size>2000)for(const [k,v]of cooldowns)if(v<Date.now())cooldowns.delete(k);
 return value;
 }
 }
 const work=request();if(method==='GET')pendingReads.set(key,work);try{return await work;}finally{if(method==='GET')pendingReads.delete(key);}
}
export function channelPermissions(guild:any,roles:any[],member:any,channel:any,images=false){
 let p=BigInt(roles.find(r=>r.id===guild.id)?.permissions??'0');for(const r of roles)if(member.roles.includes(r.id))p|=BigInt(r.permissions);
 if(guild.owner_id===member.user?.id||(p&8n)!==0n)return true;
 const overwrites=channel.permission_overwrites??[];const everyone=overwrites.find((o:any)=>o.id===guild.id);if(everyone)p=(p&~BigInt(everyone.deny))|BigInt(everyone.allow);
 let deny=0n,allow=0n;for(const o of overwrites)if(o.type===0&&member.roles.includes(o.id)){deny|=BigInt(o.deny);allow|=BigInt(o.allow);}p=(p&~deny)|allow;
 const personal=overwrites.find((o:any)=>o.type===1&&o.id===member.user.id);if(personal)p=(p&~BigInt(personal.deny))|BigInt(personal.allow);
 const required=1024n|2048n|16384n|(images?32768n:0n);return (p&required)===required;
}
