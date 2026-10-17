import pg from 'pg';
import {logFailure} from './logging.js';
import { isFresh, meetsTarget, type Direction } from './domain.js';
import type { PriceRepository, MiscItemType } from './prices.js';
export type Alert = {id:string;user_id:string;card_id:string;card_name:string;platform:string;game_year:number;direction:Direction;target:string;state:string};
export type MiscAlert = {id:string;user_id:string;game_year:number;platform:string;item_type:MiscItemType;item_id:string;item_label:string;direction:Direction;target_price:string;baseline_price:string;state:string};
export class AlertRepository {
  pool:pg.Pool;
  constructor(url:string){this.pool=new pg.Pool({connectionString:url,max:4,application_name:'futbot-app',connectionTimeoutMillis:10000,idleTimeoutMillis:30000,keepAlive:true,statement_timeout:15000});this.pool.on('error',error=>logFailure('Application database idle connection error',error));}
  async list(userId:string){return (await this.pool.query<Alert>(`SELECT * FROM futbot_alerts WHERE user_id=$1 AND state IN ('active','queued','paused','failed') ORDER BY id DESC LIMIT 25`,[userId])).rows;}
  async create(input:{userId:string;guildId:string|null;cardId:string;cardName:string;year:number;platform:string;direction:Direction;target:number},limit=5){
    const c=await this.pool.connect();
    try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[input.userId]);
      const count=await c.query(`SELECT ((SELECT count(*) FROM futbot_alerts WHERE user_id=$1 AND state IN ('active','queued','paused'))+(SELECT count(*) FROM futbot_fodder_alerts WHERE user_id=$1 AND state IN ('active','queued')))::int AS n`,[input.userId]);
      if(count.rows[0].n>=limit)throw new Error(`You have reached your limit of ${limit} saved alerts.`);
      const {rows}=await c.query<Alert>(`INSERT INTO futbot_alerts(user_id,guild_id,card_id,card_name,game_year,platform,direction,target) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[input.userId,input.guildId,input.cardId,input.cardName,input.year,input.platform,input.direction,input.target]);
      await c.query('COMMIT');return rows[0];
    }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  }
  async createMisc(input:{userId:string;year:number;platform:string;itemType:MiscItemType;itemId:string;itemLabel:string;direction:Direction;target:number;baseline:number},limit=5){
    const c=await this.pool.connect();
    try{
      await c.query('BEGIN');
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[input.userId]);
      const count=await c.query(`SELECT (
        (SELECT count(*) FROM futbot_alerts WHERE user_id=$1 AND state IN ('active','queued','paused'))+
        (SELECT count(*) FROM futbot_fodder_alerts WHERE user_id=$1 AND state IN ('active','queued'))+
        (SELECT count(*) FROM futbot_misc_alerts WHERE user_id=$1 AND state IN ('active','queued'))
      )::int AS n`,[input.userId]);
      if(Number(count.rows[0].n)>=limit)throw new Error(`You have reached your limit of ${limit} saved alerts.`);
      const {rows}=await c.query(`INSERT INTO futbot_misc_alerts
        (user_id,game_year,platform,item_type,item_id,item_label,direction,target_price,baseline_price)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,[
          input.userId,input.year,input.platform,input.itemType,input.itemId,input.itemLabel,
          input.direction,input.target,input.baseline
        ]);
      await c.query('COMMIT');return rows[0];
    }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  }
  async edit(userId:string,id:string,target:number,direction:Direction){
    if(!Number.isInteger(target)||target<1||target>15000000||!['above','below'].includes(direction))throw new Error('Choose a valid target and direction.');
    const r=await this.pool.query("UPDATE futbot_alerts SET target=$3,direction=$4 WHERE user_id=$1 AND id=$2 AND state IN ('active','paused') RETURNING id",[userId,id,target,direction]);
    if(!r.rowCount)throw new Error('Only your active or paused alerts can be edited. The alert may already be queued.');
  }
  async remove(userId:string,id:string){const r=await this.pool.query(`UPDATE futbot_alerts SET state='cancelled' WHERE id=$1 AND user_id=$2 AND state IN ('active','paused','failed') RETURNING id`,[id,userId]);return !!r.rowCount;}
}
export async function alertTick(repo:AlertRepository,prices:PriceRepository,maxAge:number,send:(userId:string,alert:Alert,value:number,capturedAt:Date)=>Promise<void>){
  const c=await repo.pool.connect();
  try{
    const lock=await c.query('SELECT pg_try_advisory_lock(428107) AS locked');if(!lock.rows[0].locked)return;
    const active=(await c.query<Alert>(`SELECT * FROM futbot_alerts WHERE state='active' AND game_year=$1 ORDER BY id`,[prices.year])).rows;
    const cache=new Map<string,Awaited<ReturnType<PriceRepository['latest']>>>();
    for(const a of active){
      const key=`${a.card_id}:${a.platform}`;
      try{
        if(!cache.has(key))cache.set(key,await prices.latest(a.card_id,a.platform));
        const price=cache.get(key);if(!price||!isFresh(price.capturedAt,maxAge)||!meetsTarget(price.value,Number(a.target),a.direction))continue;
        await c.query('BEGIN');
        const claimed=await c.query(`UPDATE futbot_alerts SET state='queued' WHERE id=$1 AND state='active' RETURNING id`,[a.id]);
        if(claimed.rowCount)await c.query(`INSERT INTO futbot_outbox(alert_id,observed_price,captured_at) VALUES($1,$2,$3) ON CONFLICT(alert_id) DO NOTHING`,[a.id,price.value,price.capturedAt]);
        await c.query('COMMIT');
      }catch(e){await c.query('ROLLBACK');logFailure('Alert price check failed / alert '+a.id,e);}
    }
    const pending=await c.query(`SELECT o.id AS outbox_id,o.observed_price,o.captured_at,o.attempts,a.* FROM futbot_outbox o JOIN futbot_alerts a ON a.id=o.alert_id WHERE o.status='pending' AND o.retry_at<=now() AND a.state='queued' ORDER BY o.id LIMIT 50`);
    for(const row of pending.rows){
      try{await send(row.user_id,row,Number(row.observed_price),row.captured_at);
        await c.query('BEGIN');await c.query(`UPDATE futbot_outbox SET status='delivered' WHERE id=$1`,[row.outbox_id]);
        await c.query(`UPDATE futbot_alerts SET state='triggered',triggered_at=now() WHERE id=$1`,[row.id]);await c.query('COMMIT');
      }catch(e){logFailure('Alert delivery failed / alert '+row.id,e);await c.query('ROLLBACK');const failed=row.attempts>=4;
        await c.query(`UPDATE futbot_outbox SET attempts=attempts+1,status=$2,retry_at=now()+interval '5 minutes',last_error=$3 WHERE id=$1`,[row.outbox_id,failed?'failed':'pending',e instanceof Error?e.name:'DeliveryError']);
        if(failed)await c.query(`UPDATE futbot_alerts SET state='failed' WHERE id=$1`,[row.id]);
      }
    }
  }finally{await c.query('SELECT pg_advisory_unlock(428107)').catch(()=>{});c.release();}
}

export async function fodderAlertTick(repo:AlertRepository,prices:PriceRepository,maxAge:number,send:(userId:string,alert:any,current:number,capturedAt:Date)=>Promise<void>){
  const c=await repo.pool.connect();
  try{
    const lock=await c.query('SELECT pg_try_advisory_lock(428109) AS locked');if(!lock.rows[0].locked)return;
    const alerts=(await c.query(`SELECT * FROM futbot_fodder_alerts WHERE state='active' AND game_year=$1 ORDER BY id`,[prices.year])).rows;
    const cache=new Map<string,Awaited<ReturnType<PriceRepository['fodderIndex']>>>();
    for(const a of alerts){
      const key=`${a.platform}:${a.rating}`;
      try{
        if(!cache.has(key))cache.set(key,await prices.fodderIndex(a.platform,a.rating,maxAge));
        const index=cache.get(key);if(!index||index.value>Number(a.target_price))continue;
        const claimed=await c.query(`UPDATE futbot_fodder_alerts SET state='queued',last_error=NULL WHERE id=$1 AND state='active' RETURNING id`,[a.id]);if(!claimed.rowCount)continue;
        try{await send(a.user_id,a,index.value,index.capturedAt);await c.query(`UPDATE futbot_fodder_alerts SET state='triggered',triggered_at=now() WHERE id=$1 AND state='queued'`,[a.id]);}
        catch(e){await c.query(`UPDATE futbot_fodder_alerts SET state='failed',last_error=$2 WHERE id=$1 AND state='queued'`,[a.id,e instanceof Error?e.name:'DeliveryError']);logFailure('Fodder alert delivery failed / alert '+a.id,e);}
      }catch(e){logFailure('Fodder index check failed / alert '+a.id,e);}
    }
  }finally{await c.query('SELECT pg_advisory_unlock(428109)').catch(()=>{});c.release();}
}

export async function miscAlertTick(repo:AlertRepository,prices:PriceRepository,maxAge:number,send:(userId:string,alert:MiscAlert,value:number,capturedAt:Date)=>Promise<void>){
  const c=await repo.pool.connect();
  try{
    const lock=await c.query('SELECT pg_try_advisory_lock(428110) AS locked');
    if(!lock.rows[0].locked)return;
    const active=(await c.query<MiscAlert>(`SELECT * FROM futbot_misc_alerts
      WHERE state='active' AND game_year=$1 ORDER BY id`,[prices.year])).rows;
    const cache=new Map<string,Awaited<ReturnType<PriceRepository['miscLatest']>>>();
    for(const alert of active){
      const key=`${alert.platform}:${alert.item_type}:${alert.item_id}`;
      try{
        if(!cache.has(key))cache.set(key,await prices.miscLatest(alert.item_type,alert.item_id,alert.platform));
        const item=cache.get(key);
        if(!item||item.price===null||!isFresh(item.captured_at,maxAge))continue;
        const target=Number(alert.target_price);
        const reached=alert.direction==='below'?item.price<=target:item.price>=target;
        if(!reached)continue;
        const claimed=await c.query(`UPDATE futbot_misc_alerts SET state='queued',last_error=NULL
          WHERE id=$1 AND state='active' RETURNING id`,[alert.id]);
        if(!claimed.rowCount)continue;
        try{
          await send(alert.user_id,alert,item.price,item.captured_at);
          await c.query(`UPDATE futbot_misc_alerts SET state='triggered',triggered_at=now()
            WHERE id=$1 AND state='queued'`,[alert.id]);
        }catch(error){
          await c.query(`UPDATE futbot_misc_alerts SET state='failed',last_error=$2
            WHERE id=$1 AND state='queued'`,[alert.id,error instanceof Error?error.name:'DeliveryError']);
          logFailure('Consumable alert delivery failed / alert '+alert.id,error);
        }
      }catch(error){logFailure('Consumable price check failed / alert '+alert.id,error);}
    }
  }finally{await c.query('SELECT pg_advisory_unlock(428110)').catch(()=>{});c.release();}
}
