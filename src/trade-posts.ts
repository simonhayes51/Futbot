import type pg from "pg";
import type {PriceRepository} from "./prices.js";
import {isFresh} from "./domain.js";

export type TradeTriggerType="price"|"drop_pct";
export type TradePost={
 id:string;guild_id:string;user_id:string;channel_id:string;card_id:string;card_name:string;
 game_year:number;platform:"ps5"|"pc";trigger_type:TradeTriggerType;trigger_value:number;
 baseline_price:number;buy_price:number;sell_price:number|null;note:string;state:string;attempts:number;
 created_at:Date;last_checked_at:Date|null;posting_at:Date|null;triggered_at:Date|null;message_id:string|null;last_error:string|null;
};
export type NewTradePost={guildId:string;userId:string;channelId:string;cardId:string;cardName:string;year:number;platform:"ps5"|"pc";triggerType:TradeTriggerType;triggerValue:number;baselinePrice:number;buyPrice:number;sellPrice:number|null;note:string};

export function tradeBuyPrice(type:TradeTriggerType,value:number,baseline:number){
 if(!Number.isFinite(value)||!Number.isInteger(baseline)||baseline<1)throw new Error("Choose a valid price trigger.");
 if(type==="price"){
  if(!Number.isInteger(value)||value<1000||value>15000000)throw new Error("Choose a buy price between 1,000 and 15,000,000 coins.");
  return value;
 }
 if(type!=="drop_pct"||!Number.isInteger(value)||value<1||value>50)throw new Error("Choose a whole percentage from 1 to 50.");
 return Math.max(1,Math.floor(baseline*(1-value/100)));
}

export async function createTradePost(pool:pg.Pool,input:NewTradePost){
 if(!/^\d{17,20}$/.test(input.guildId)||!/^\d{17,20}$/.test(input.userId)||!/^\d{17,20}$/.test(input.channelId))throw new Error("Run this in a valid Discord server and choose a server channel.");
 if(!/^\d+$/.test(input.cardId)||!input.cardName||!Number.isInteger(input.year)||!['ps5','pc'].includes(input.platform))throw new Error("Choose a valid player card and market.");
 if(input.buyPrice>=input.baselinePrice)throw new Error("Your buy trigger must be below the current BIN, or it would post immediately.");
 if(input.sellPrice!==null&&(!Number.isInteger(input.sellPrice)||input.sellPrice<=input.buyPrice||input.sellPrice>15000000))throw new Error("The sell price must be higher than the buy price and no more than 15,000,000 coins.");
 const note=String(input.note??"").trim().replace(/@/g,"@​").slice(0,240);
 const c=await pool.connect();
 try{
  await c.query("BEGIN");
  await c.query("SELECT pg_advisory_xact_lock(hashtext($1))",["trade-posts:"+input.guildId+":"+input.userId]);
  const count=await c.query("SELECT count(*)::int AS n FROM futbot_trade_posts WHERE guild_id=$1 AND user_id=$2 AND state IN ('active','posting')",[input.guildId,input.userId]);
  if(Number(count.rows[0]?.n??0)>=10)throw new Error("You can have up to 10 active trade posts. Cancel one before adding another.");
  const result=await c.query("INSERT INTO futbot_trade_posts(guild_id,user_id,channel_id,card_id,card_name,game_year,platform,trigger_type,trigger_value,baseline_price,buy_price,sell_price,note) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id",[input.guildId,input.userId,input.channelId,input.cardId,input.cardName,input.year,input.platform,input.triggerType,input.triggerValue,input.baselinePrice,input.buyPrice,input.sellPrice,note]);
  await c.query("COMMIT");return String(result.rows[0].id);
 }catch(error){await c.query("ROLLBACK");throw error;}finally{c.release();}
}

export async function listTradePosts(pool:pg.Pool,guildId:string,userId:string){
 return (await pool.query("SELECT id::text,card_name,platform,buy_price,sell_price,channel_id,state,created_at,last_error FROM futbot_trade_posts WHERE guild_id=$1 AND user_id=$2 AND state IN ('active','posting','posted','failed') ORDER BY CASE state WHEN 'active' THEN 0 WHEN 'posting' THEN 1 ELSE 2 END,created_at DESC LIMIT 20",[guildId,userId])).rows;
}
export async function cancelTradePost(pool:pg.Pool,guildId:string,userId:string,id:string){
 if(!/^\d+$/.test(id))throw new Error("Choose a valid trade post ID.");
 const r=await pool.query("UPDATE futbot_trade_posts SET state='cancelled' WHERE id=$1 AND guild_id=$2 AND user_id=$3 AND state='active' RETURNING id",[id,guildId,userId]);
 if(!r.rowCount)throw new Error("No active trade post with that ID belongs to you.");
}

export async function tradePostTick(pool:pg.Pool,prices:PriceRepository,maxAge:number,publish:(post:TradePost,price:{value:number;capturedAt:Date})=>Promise<string|null>){
 const due=(await pool.query("SELECT id FROM futbot_trade_posts WHERE state='active' OR (state='posting' AND posting_at<now()-interval '5 minutes') ORDER BY last_checked_at NULLS FIRST,created_at LIMIT 30")).rows;
 for(const candidate of due){
  const claimed=await pool.query("UPDATE futbot_trade_posts SET state='posting',posting_at=now() WHERE id=$1 AND (state='active' OR (state='posting' AND posting_at<now()-interval '5 minutes')) RETURNING *",[candidate.id]);
  if(!claimed.rowCount)continue;
  const post=claimed.rows[0] as TradePost;
  try{
   const latest=await prices.latest(post.card_id,post.platform);
   if(!latest||!isFresh(latest.capturedAt,maxAge)||latest.value>Number(post.buy_price)){
    await pool.query("UPDATE futbot_trade_posts SET state='active',posting_at=NULL,last_checked_at=now() WHERE id=$1 AND state='posting'",[post.id]);continue;
   }
   const messageId=await publish(post,{value:Number(latest.value),capturedAt:latest.capturedAt});
   if(!messageId){await pool.query("UPDATE futbot_trade_posts SET state='cancelled',posting_at=NULL,last_error='Trader role or channel access was removed.' WHERE id=$1 AND state='posting'",[post.id]);continue;}
   await pool.query("UPDATE futbot_trade_posts SET state='posted',posting_at=NULL,triggered_at=$2,message_id=$3,last_error=NULL WHERE id=$1 AND state='posting'",[post.id,latest.capturedAt,messageId]);
  }catch(error){
   const message=error instanceof Error?error.message:"Delivery failed";
   await pool.query("UPDATE futbot_trade_posts SET attempts=attempts+1,state=CASE WHEN attempts>=4 THEN 'failed' ELSE 'active' END,posting_at=NULL,last_checked_at=now(),last_error=$2 WHERE id=$1 AND state='posting'",[post.id,message.slice(0,300)]).catch(()=>{});
  }
 }
}
