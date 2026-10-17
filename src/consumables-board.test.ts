import assert from 'node:assert/strict';
import test from 'node:test';
import {rankConsumables} from './boards.js';

const item=(item_id:string,price:number|null,baseline_price:number|null)=>({
 item_type:'chemistry_style' as const,item_id,price,status:'priced',
 captured_at:new Date(),price_updated_at:null,last_checked_at:null,baseline_price,
});

test('consumable rankings separate risers, fallers and missing baselines',()=>{
 const rows=[item('250',110,100),item('251',80,100),item('252',150,null),item('253',100,100)];
 assert.deepEqual(rankConsumables(rows,'risers',5).map(r=>r.item_id),['250']);
 assert.deepEqual(rankConsumables(rows,'fallers',5).map(r=>r.item_id),['251']);
 assert.deepEqual(rankConsumables(rows,'all',5).map(r=>r.item_id),['250','251']);
});
