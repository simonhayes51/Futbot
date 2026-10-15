import Stripe from 'stripe';
import type pg from 'pg';
import {randomBytes} from 'node:crypto';
import {plans,type Plan} from './plans.js';
const priceId=(plan:Plan)=>process.env['STRIPE_PRICE_'+plan.toUpperCase()]??'';
export function billingReady(){return !!(process.env.STRIPE_SECRET_KEY&&process.env.STRIPE_WEBHOOK_SECRET);}
export function catalogue(){return Object.entries(plans).map(([id,p])=>({id,...p,available:billingReady()&&!!priceId(id as Plan)}));}
export class Billing{
 private client:Stripe|null;
 constructor(private pool:pg.Pool,private origin:string,client?:Stripe){this.client=client??(process.env.STRIPE_SECRET_KEY?new Stripe(process.env.STRIPE_SECRET_KEY,{apiVersion:'2026-08-26.dahlia',maxNetworkRetries:2,timeout:15000}):null);}
 private stripe(){if(!this.client||!billingReady())throw new Error('Billing is not configured yet.');return this.client;}
 async checkout(user:string,scope:'user'|'guild',id:string,plan:Plan){
 const stripe=this.stripe();if(!priceId(plan)||plan==='free'||(scope==='user'?plan!=='personal':['personal','free'].includes(plan)))throw new Error('Choose an available plan for this workspace.');
 const price=await stripe.prices.retrieve(priceId(plan));if(!price.active||price.currency!=='gbp'||price.unit_amount!==Math.round(plans[plan].price*100)||price.recurring?.interval!=='month'||price.recurring.interval_count!==1)throw new Error('This Stripe price does not match the advertised monthly GBP plan.');
 const c=await this.pool.connect();try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['billing:'+scope+':'+id]);
 const existing=(await c.query('SELECT * FROM futbot_subscriptions WHERE scope=$1 AND scope_id=$2',[scope,id])).rows[0];
 if(existing&&!['canceled','incomplete_expired'].includes(existing.status))throw new Error('A subscription already exists. Its purchaser can manage it through billing.');
 const pending=(await c.query('SELECT * FROM futbot_checkout WHERE scope=$1 AND scope_id=$2 AND expires_at>now()',[scope,id])).rows[0];
 if(pending){if(pending.owner_id!==user)throw new Error('Another administrator has a checkout in progress. Try again in 30 minutes.');if(pending.plan===plan){await c.query('COMMIT');return {url:pending.url};}await stripe.checkout.sessions.expire(pending.session_id);}
 const customer=existing?.customer_id&&existing.owner_id===user?existing.customer_id:undefined;
 const suffix=Array.from(randomBytes(8),v=>String.fromCharCode(97+v%26)).join('');
 const session=await stripe.checkout.sessions.create({mode:'subscription',...(customer?{customer}:{}),client_reference_id:user,line_items:[{price:priceId(plan),quantity:1}],subscription_data:{metadata:{scope,scope_id:id,owner_id:user,plan}},success_url:this.origin+'/app/?billing=success',cancel_url:this.origin+'/app/?billing=cancelled',expires_at:Math.floor(Date.now()/1000)+1800,integration_identifier:'futbot_'+suffix} as any,{idempotencyKey:'fb-'+scope+'-'+id+'-'+suffix});
 await c.query('INSERT INTO futbot_checkout(scope,scope_id,owner_id,plan,session_id,url,expires_at) VALUES($1,$2,$3,$4,$5,$6,to_timestamp($7)) ON CONFLICT(scope,scope_id) DO UPDATE SET owner_id=EXCLUDED.owner_id,plan=EXCLUDED.plan,session_id=EXCLUDED.session_id,url=EXCLUDED.url,expires_at=EXCLUDED.expires_at',[scope,id,user,plan,session.id,session.url,session.expires_at]);
 await c.query('COMMIT');return {url:session.url};
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 }
 async portal(user:string,scope:string,id:string){const stripe=this.stripe(),row=(await this.pool.query('SELECT customer_id FROM futbot_subscriptions WHERE scope=$1 AND scope_id=$2 AND owner_id=$3',[scope,id,user])).rows[0];if(!row?.customer_id)throw new Error('Only the subscription purchaser can manage billing.');const configuration=process.env[scope==='guild'?'STRIPE_PORTAL_SERVER_CONFIG':'STRIPE_PORTAL_PERSONAL_CONFIG'];return stripe.billingPortal.sessions.create({customer:row.customer_id,return_url:this.origin+'/app/?billing=return',...(configuration?{configuration}:{})});}
 async webhook(raw:Buffer,signature:string){
 const stripe=this.stripe();let event:Stripe.Event;try{event=stripe.webhooks.constructEvent(raw,signature,process.env.STRIPE_WEBHOOK_SECRET!);}catch{throw new Error('Invalid webhook signature.');}
 const c=await this.pool.connect();try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtext($1))',['stripe-events']);if((await c.query('SELECT 1 FROM futbot_stripe_events WHERE id=$1',[event.id])).rowCount){await c.query('COMMIT');return;}
 const obj:any=event.data.object;let subId:string|undefined;
 if(event.type.startsWith('customer.subscription.'))subId=obj.id;
 else if(['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(event.type))subId=typeof obj.subscription==='string'?obj.subscription:obj.subscription?.id;
 else if(['invoice.paid','invoice.payment_failed','invoice.payment_action_required'].includes(event.type))subId=obj.parent?.subscription_details?.subscription??obj.subscription;
 if(subId){
 // Retrieve current state under a transaction lock: replayed/out-of-order events cannot restore an old plan.
 const sub:any=await stripe.subscriptions.retrieve(subId,{expand:['latest_invoice']});
 const existing=(await c.query('SELECT * FROM futbot_subscriptions WHERE subscription_id=$1',[sub.id])).rows[0];
 // Resolve new subscriptions through the stored Checkout Session, not untrusted metadata.
 let pending:any;if(!existing){const sessions=await stripe.checkout.sessions.list({subscription:sub.id,limit:1});const checkout=sessions.data[0];if(checkout)pending=(await c.query('SELECT * FROM futbot_checkout WHERE session_id=$1',[checkout.id])).rows[0];}
 const mapping=existing??pending;
 const configured=Object.keys(plans).find(p=>priceId(p as Plan)&&priceId(p as Plan)===sub.items.data[0]?.price.id) as Plan|undefined;
 if(mapping){
 const compatible=!!configured&&sub.items.data.length===1&&(mapping.scope==='user'?configured==='personal':!['free','personal'].includes(configured));
 const current=(await c.query('SELECT subscription_id FROM futbot_subscriptions WHERE scope=$1 AND scope_id=$2',[mapping.scope,mapping.scope_id])).rows[0];
 // Ignore delayed events from a superseded subscription.
 if(!current||current.subscription_id===sub.id||pending){
 const invoice=sub.latest_invoice,status=sub.status==='trialing'?'trialing':sub.status==='active'&&invoice?.status==='paid'?'active':sub.status==='active'?'pending_payment':sub.status;
 const until=compatible?(sub.items.data[0]?.current_period_end??sub.trial_end??0):0;
 await c.query(`INSERT INTO futbot_subscriptions(scope,scope_id,owner_id,plan,status,customer_id,subscription_id,paid_until,cancel_at_period_end) VALUES($1,$2,$3,$4,$5,$6,$7,to_timestamp($8),$9) ON CONFLICT(scope,scope_id) DO UPDATE SET owner_id=EXCLUDED.owner_id,plan=EXCLUDED.plan,status=EXCLUDED.status,customer_id=EXCLUDED.customer_id,subscription_id=EXCLUDED.subscription_id,paid_until=EXCLUDED.paid_until,cancel_at_period_end=EXCLUDED.cancel_at_period_end,updated_at=now()`,[mapping.scope,mapping.scope_id,mapping.owner_id,compatible?configured:mapping.plan,compatible?status:'unsupported_plan',typeof sub.customer==='string'?sub.customer:sub.customer.id,sub.id,until,sub.cancel_at_period_end]);
 }
 }
 }
 await c.query('INSERT INTO futbot_stripe_events(id) VALUES($1)',[event.id]);await c.query('COMMIT');
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
 }
}
