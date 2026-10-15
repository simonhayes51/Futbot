import test from 'node:test';import assert from 'node:assert/strict';
import {testDatabase} from './test-db.js';import {communityRoute} from './community.js';
const g='223456789012345678',other='323456789012345678';
test('shared list reads and writes cannot cross server boundaries; management routes require admin',async t=>{
 const {db,pool}=await testDatabase();t.after(()=>db.close());const original=globalThis.fetch;globalThis.fetch=(async(input:any)=>String(input).includes('/members/')?new Response(JSON.stringify({roles:[],user:{id:'member'}}),{status:200}):new Response('{}',{status:404})) as any;t.after(()=>{globalThis.fetch=original;});
 for(const guild of [g,other])await pool.query("INSERT INTO futbot_subscriptions(scope,scope_id,owner_id,plan,status,paid_until) VALUES('guild',$1,'owner','tools','active',now()+interval '1 day')",[guild]);
 const list=(await pool.query("INSERT INTO futbot_shared_lists(guild_id,name,created_by) VALUES($1,'Other server private list','owner') RETURNING id",[other])).rows[0].id;
 const base:any={pool,market:{prices:{year:27},platform:'ps5'},billing:{},user:'member',method:'POST',read:async()=>({list}),admin:async()=>{throw Error('Admin required');},memberGuilds:async()=>[],audit:async()=>{}};
 const read=await communityRoute({...base,path:`/api/communities/${g}/cards`});assert.deepEqual(read.cards,[]);
 await assert.rejects(()=>communityRoute({...base,path:`/api/guilds/${g}/shared`,method:'DELETE'}),/Admin required/);
 await assert.rejects(()=>communityRoute({...base,admin:async()=>({}),path:`/api/guilds/${g}/shared`,method:'DELETE'}),/not found in this server/);
 assert.equal((await pool.query('SELECT count(*)::int AS n FROM futbot_shared_lists')).rows[0].n,1);
});
