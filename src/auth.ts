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
export async function discord(path:string,token:string,method='GET',body?:unknown,bearer=false){
 const r=await fetch('https://discord.com/api/v10'+path,{method,headers:{Authorization:`${bearer?'Bearer':'Bot'} ${token}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(12000)});
 if(!r.ok)throw new HttpError(r.status===429?429:r.status===401?401:502,r.status===429?'Discord is busy. Try again shortly.':r.status===401?'Your Discord session expired. Sign in again.':'Discord could not complete this request. Check bot membership and permissions.');
 return r.status===204?null:r.json();
}
export function channelPermissions(guild:any,roles:any[],member:any,channel:any){
 let p=BigInt(roles.find(r=>r.id===guild.id)?.permissions??'0');for(const r of roles)if(member.roles.includes(r.id))p|=BigInt(r.permissions);
 if(guild.owner_id===member.user?.id||(p&8n)!==0n)return true;
 const overwrites=channel.permission_overwrites??[];const everyone=overwrites.find((o:any)=>o.id===guild.id);if(everyone)p=(p&~BigInt(everyone.deny))|BigInt(everyone.allow);
 let deny=0n,allow=0n;for(const o of overwrites)if(o.type===0&&member.roles.includes(o.id)){deny|=BigInt(o.deny);allow|=BigInt(o.allow);}p=(p&~deny)|allow;
 const personal=overwrites.find((o:any)=>o.type===1&&o.id===member.user.id);if(personal)p=(p&~BigInt(personal.deny))|BigInt(personal.allow);
 const required=1024n|2048n|16384n;return (p&required)===required;
}
