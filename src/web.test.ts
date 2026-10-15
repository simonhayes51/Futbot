import test from 'node:test';import assert from 'node:assert/strict';
import {createWeb,safeStaticPath} from './web.js';
import {encrypt} from './auth.js';
test('live API rejects anonymous access, forged mutations and unauthorized servers',async()=>{
 Object.assign(process.env,{PUBLIC_URL:'http://127.0.0.1:3000',DISCORD_CLIENT_ID:'client',DISCORD_CLIENT_SECRET:'secret',DISCORD_TOKEN:'bot',SESSION_SECRET:'s'.repeat(40)});
 const queries:any[]=[];const pool:any={query:async(sql:string,params:any[])=>{queries.push({sql,params});if(sql.startsWith('SELECT * FROM futbot_sessions'))return {rows:[{session_hash:'hash',user_id:'member',profile:{id:'member'},csrf:'csrf',token_cipher:encrypt('access','s'.repeat(40))}]};return {rows:[]};}};
 const server=createWeb({year:27} as any,{pool} as any,{} as any);await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));const address=server.address() as any,base='http://127.0.0.1:'+address.port;const realFetch=globalThis.fetch;
 try{
 assert.equal((await realFetch(base+'/api/me')).status,401);
 assert.equal((await realFetch(base+'/auth/callback?code=bad&state=forged')).status,400);
 assert.equal((await realFetch(base+'/api/alerts',{method:'POST',headers:{Cookie:'futbot=token','Content-Type':'application/json'},body:'{}'})).status,403);
 const r=await realFetch(base+'/api/alerts',{headers:{Cookie:'futbot=token'}});assert.equal(r.status,200);assert(queries.some(q=>q.sql.includes('WHERE user_id=$1')&&q.params[0]==='member'));
 globalThis.fetch=(async(input:any,init:any)=>String(input).startsWith('https://discord.com/')?new Response(JSON.stringify([{id:'123456789012345678',permissions:'1024'}]),{status:200,headers:{'Content-Type':'application/json'}}):realFetch(input,init)) as any;
 assert.equal((await realFetch(base+'/api/guilds/123456789012345678/settings',{headers:{Cookie:'futbot=token'}})).status,403);
 }finally{globalThis.fetch=realFetch;await new Promise<void>(r=>server.close(()=>r()));}
 assert.throws(()=>safeStaticPath('/../../secret'));
});
