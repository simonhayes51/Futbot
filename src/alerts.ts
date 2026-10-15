import pg from 'pg';
import { isFresh, meetsTarget, type Direction } from './domain.js';
import type { PriceRepository } from './prices.js';
export type Alert = {id:string;user_id:string;card_id:string;card_name:string;platform:string;game_year:number;direction:Direction;target:string;state:string};
export class AlertRepository {
  pool:pg.Pool;
  constructor(url:string){this.pool=new pg.Pool({connectionString:url,max:4,application_name:'futbot-app'});}
  async list(userId:string){return (await this.pool.query<Alert>(`SELECT * FROM futbot_alerts WHERE user_id=$1 AND state IN ('active','queued','paused','failed') ORDER BY id DESC LIMIT 25`,[userId])).rows;}
  async create(input:{userId:string;guildId:string|null;cardId:string;cardName:string;year:number;platform:string;direction:Direction;target:number},limit=5){
    const c=await this.pool.connect();
    try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',[input.userId]);
      const count=await c.query(`SELECT count(*)::int AS n FROM futbot_alerts WHERE user_id=$1 AND state IN ('active','queued','paused')`,[input.userId]);
      if(count.rows[0].n>=limit)throw new Error(`You have reached your limit of ${limit} saved alerts.`);
      const {rows}=await c.query<Alert>(`INSERT INTO futbot_alerts(user_id,guild_id,card_id,card_name,game_year,platform,direction,target) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,[input.userId,input.guildId,input.cardId,input.cardName,input.year,input.platform,input.direction,input.target]);
      await c.query('COMMIT');return rows[0];
    }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
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
      }catch(e){await c.query('ROLLBACK');console.error('Alert check failed for',a.id);}
    }
    const pending=await c.query(`SELECT o.id AS outbox_id,o.observed_price,o.captured_at,o.attempts,a.* FROM futbot_outbox o JOIN futbot_alerts a ON a.id=o.alert_id WHERE o.status='pending' AND o.retry_at<=now() AND a.state='queued' ORDER BY o.id LIMIT 50`);
    for(const row of pending.rows){
      try{await send(row.user_id,row,Number(row.observed_price),row.captured_at);
        await c.query('BEGIN');await c.query(`UPDATE futbot_outbox SET status='delivered' WHERE id=$1`,[row.outbox_id]);
        await c.query(`UPDATE futbot_alerts SET state='triggered',triggered_at=now() WHERE id=$1`,[row.id]);await c.query('COMMIT');
      }catch(e){await c.query('ROLLBACK');const failed=row.attempts>=4;
        await c.query(`UPDATE futbot_outbox SET attempts=attempts+1,status=$2,retry_at=now()+interval '5 minutes',last_error=$3 WHERE id=$1`,[row.outbox_id,failed?'failed':'pending',e instanceof Error?e.name:'DeliveryError']);
        if(failed)await c.query(`UPDATE futbot_alerts SET state='failed' WHERE id=$1`,[row.id]);
      }
    }
  }finally{await c.query('SELECT pg_advisory_unlock(428107)').catch(()=>{});c.release();}
}
