import test from 'node:test';import assert from 'node:assert/strict';import Stripe from 'stripe';
import {Billing} from './billing.js';import {testDatabase} from './test-db.js';import {userBenefits} from './plans.js';
test('signed billing events map stored checkout, dedupe and reconcile current subscription state',async t=>{
 const {db,pool}=await testDatabase();t.after(()=>db.close());const old={...process.env};Object.assign(process.env,{STRIPE_SECRET_KEY:'unit-fixture',STRIPE_WEBHOOK_SECRET:'unit-signature-fixture',STRIPE_PRICE_PERSONAL:'price_personal_fixture'});t.after(()=>{process.env=old;});
 const sdk=new Stripe('unit-fixture');let retrieves=0;const period=Math.floor(Date.now()/1000)+86400;
 let sub:any={id:'sub_fixture',status:'active',customer:'cus_fixture',metadata:{scope:'guild',scope_id:'untrusted'},items:{data:[{price:{id:'price_personal_fixture'},current_period_end:period}]},latest_invoice:{status:'paid'},cancel_at_period_end:false};
 const client:any={webhooks:sdk.webhooks,subscriptions:{retrieve:async()=>{retrieves++;return sub;}},checkout:{sessions:{list:async()=>({data:[{id:'cs_fixture'}]})}}};
 await pool.query("INSERT INTO futbot_checkout(scope,scope_id,owner_id,plan,session_id,url,expires_at) VALUES('user','member','member','personal','cs_fixture','https://checkout.stripe.com/fixture',now()+interval '1 hour')");
 const billing=new Billing(pool,'https://futbot.test',client);
 async function deliver(id:string,type='invoice.paid'){const payload=JSON.stringify({id,type,data:{object:type.startsWith('customer.subscription.')?{id:'sub_fixture'}:{parent:{subscription_details:{subscription:'sub_fixture'}}}}});const header=sdk.webhooks.generateTestHeaderString({payload,secret:'unit-signature-fixture'});await billing.webhook(Buffer.from(payload),header);}
 await assert.rejects(()=>billing.webhook(Buffer.from('{}'),'forged'),/signature/);
 await deliver('evt_1');assert.equal((await userBenefits(pool,'member',async()=>null)).plan,'personal');assert.equal((await pool.query('SELECT scope FROM futbot_subscriptions')).rows[0].scope,'user');
 await deliver('evt_1');assert.equal(retrieves,1);
 sub={...sub,status:'past_due',latest_invoice:{status:'open'}};await deliver('evt_2','invoice.payment_failed');assert.equal((await userBenefits(pool,'member',async()=>null)).plan,'free');
 sub={...sub,status:'active',latest_invoice:{status:'paid'}};await deliver('evt_3');assert.equal((await userBenefits(pool,'member',async()=>null)).plan,'personal');
 // An older event still retrieves the latest cancelled state, never its stale active payload.
 sub={...sub,status:'canceled'};await deliver('evt_4','customer.subscription.updated');assert.equal((await userBenefits(pool,'member',async()=>null)).plan,'free');
 sub={...sub,status:'active',items:{data:[{price:{id:'unconfigured-price'},current_period_end:period}]}};await deliver('evt_5');assert.equal((await pool.query('SELECT status FROM futbot_subscriptions')).rows[0].status,'unsupported_plan');
});
test('checkout is scoped to purchaser, uses server prices and never grants from a return URL',async t=>{
 const {db,pool}=await testDatabase();t.after(()=>db.close());const old={...process.env};Object.assign(process.env,{STRIPE_SECRET_KEY:'unit-fixture',STRIPE_WEBHOOK_SECRET:'unit-signature-fixture',STRIPE_PRICE_PERSONAL:'price_personal_fixture'});t.after(()=>{process.env=old;});
 let create:any;const client:any={prices:{retrieve:async()=>({active:true,currency:'gbp',unit_amount:399,recurring:{interval:'month',interval_count:1}})},checkout:{sessions:{create:async(params:any)=>{create=params;return {id:'cs_fixture',url:'https://checkout.stripe.com/fixture',expires_at:Math.floor(Date.now()/1000)+1800};}}}};const billing=new Billing(pool,'https://futbot.test',client);
 await billing.checkout('member','user','member','personal');assert.equal(create.mode,'subscription');assert.equal(create.line_items[0].price,'price_personal_fixture');assert.equal(create.payment_method_types,undefined);assert.match(create.integration_identifier,/^futbot_[a-z]{8}$/);
 assert.equal((await userBenefits(pool,'member',async()=>null)).plan,'free');
 await assert.rejects(()=>billing.checkout('other','user','member','personal'),/administrator/);
 await assert.rejects(()=>billing.checkout('member','guild','guild','personal'),/available plan/);
 await assert.rejects(()=>billing.portal('other','user','member'),/purchaser/);
});
