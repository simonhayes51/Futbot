import test from "node:test";
import assert from "node:assert/strict";
import {tradeBuyPrice} from "./trade-posts.js";
import {testDatabase} from "./test-db.js";

test("fixed buy trigger uses the chosen coin price",()=>{
 assert.equal(tradeBuyPrice("price",95000,100000),95000);
});
test("percentage trigger is fixed from the saved current BIN",()=>{
 assert.equal(tradeBuyPrice("drop_pct",5,100000),95000);
 assert.equal(tradeBuyPrice("drop_pct",3,99999),96999);
});
test("invalid trigger values are rejected",()=>{
 assert.throws(()=>tradeBuyPrice("drop_pct",51,100000));
 assert.throws(()=>tradeBuyPrice("drop_pct",2.5,100000));
 assert.throws(()=>tradeBuyPrice("price",500,100000));
});

test("trade-post migration stores active posts and enforces sell targets",async()=>{
 const {db,pool}=await testDatabase();
 try{
  const inserted=await pool.query("INSERT INTO futbot_trade_posts(guild_id,user_id,channel_id,card_id,card_name,game_year,platform,trigger_type,trigger_value,baseline_price,buy_price,sell_price) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id,state",['1449764620108824737','712239212749127740','1449764620108824738','190042','Pajor',27,'ps5','drop_pct',5,100000,95000,110000]);
  assert.equal(inserted.rows[0].state,'active');
  await assert.rejects(()=>pool.query("INSERT INTO futbot_trade_posts(guild_id,user_id,channel_id,card_id,card_name,game_year,platform,trigger_type,trigger_value,baseline_price,buy_price,sell_price) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)",['1449764620108824737','712239212749127740','1449764620108824738','190042','Pajor',27,'ps5','price',95000,100000,95000,90000]));
 }finally{await db.close();}
});
