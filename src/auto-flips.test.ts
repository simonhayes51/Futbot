import test from 'node:test';
import assert from 'node:assert/strict';
import {autoFlipsCommand,handleAutoFlips,autoFlipTick,validAutoFlipSignal} from './auto-flips.js';
import {testDatabase} from './test-db.js';

test('automatic flips require Manage Server and define set/status/off commands',async()=>{
 const command=autoFlipsCommand.toJSON();
 assert.equal(command.name,'autoflips');
 assert.deepEqual(command.options?.map(o=>o.name),['set','status','off']);
 await assert.rejects(()=>handleAutoFlips({guildId:'guild',memberPermissions:{has:()=>false}} as any,{} as any),/Manage Server/);
});

test('bot delivers fresh live calls once and cancels unavailable prices and disabled channels',async()=>{
 const {db,pool}=await testDatabase();
 try{
  const signal={id:'123',name:'Example',rating:89,rarity:'Special',entry:90_000,target:100_000,
   net:5_000,margin:5_000/90_000,episodes:1,sourceAt:Date.now(),reason:'candidate'};
  assert.equal(validAutoFlipSignal(signal),true);
  assert.equal(validAutoFlipSignal({...signal,reason:'historical'}),false);
  await pool.query("INSERT INTO futbot_flip_channels(guild_id,platform,channel_id,set_by) VALUES('guild','ps5','private','admin')");
  const enqueue=async(key:string)=>pool.query('INSERT INTO futbot_flip_outbox(signal_key,guild_id,channel_id,game_year,platform,signal,source_at) VALUES($1,$2,$3,27,$4,$5,now())',[key,'guild','private','ps5',JSON.stringify(signal)]);
  await enqueue('live-1');
  let sent=0,price=90_000;
  const prices={year:27,latest:async()=>({value:price,capturedAt:new Date()})} as any;
  const publish=async()=>{sent++;return 'message';};
  await autoFlipTick(pool,prices,15,publish);
  await autoFlipTick(pool,prices,15,publish);
  assert.equal(sent,1);
  assert.equal((await pool.query("SELECT state FROM futbot_flip_outbox WHERE signal_key='live-1'")).rows[0].state,'sent');
  await enqueue('moved-price');price=91_000;
  await autoFlipTick(pool,prices,15,publish);
  assert.equal(sent,1);
  assert.equal((await pool.query("SELECT state FROM futbot_flip_outbox WHERE signal_key='moved-price'")).rows[0].state,'cancelled');
  await enqueue('disabled');await pool.query("UPDATE futbot_flip_channels SET enabled=false WHERE guild_id='guild'");
  await autoFlipTick(pool,prices,15,publish);
  assert.equal(sent,1);
  assert.equal((await pool.query("SELECT state FROM futbot_flip_outbox WHERE signal_key='disabled'")).rows[0].state,'cancelled');
 }finally{await db.close();}
});
