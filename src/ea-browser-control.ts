import {randomUUID} from 'node:crypto';
import type pg from 'pg';
import {encrypt,decrypt,HttpError} from './auth.js';
export const EA_VIEWPORT={width:1000,height:760};
export type BrowserAction={action:'connect'|'close'|'click'|'text'|'key'|'scroll'|'reload'|'scan'|'pause'|'disconnect';x?:number;y?:number;text?:string;key?:string;delta?:number;frameAt?:string};
export function browserAction(raw:any):BrowserAction{
 const action=raw?.action;
 if(!['connect','close','click','text','key','scroll','reload','scan','pause','disconnect'].includes(action))throw new HttpError(400,'Unsupported browser action.');
 const value:BrowserAction={action};
 if(action==='click'){
  if(![raw.x,raw.y].every(v=>typeof v==='number'&&Number.isFinite(v)&&v>=0&&v<=1))throw new HttpError(400,'Tap inside the browser view.');
  if(!Number.isFinite(Date.parse(raw.frameAt)))throw new HttpError(400,'Refresh the browser view before tapping.');value.x=raw.x;value.y=raw.y;value.frameAt=raw.frameAt;
 }
 if(action==='text'){if(typeof raw.text!=='string'||!raw.text.length||raw.text.length>1000)throw new HttpError(400,'Enter up to 1,000 characters.');value.text=raw.text;}
 if(action==='key'){if(!['Enter','Tab','Backspace','Escape','ArrowDown','ArrowUp','ArrowLeft','ArrowRight','ControlOrMeta+A'].includes(raw.key))throw new HttpError(400,'Unsupported key.');value.key=raw.key;}
 if(action==='scroll'){if(!Number.isFinite(raw.delta)||Math.abs(raw.delta)>760)throw new HttpError(400,'Invalid scroll amount.');value.delta=raw.delta;}
 return value;
}
export function browserSecret():string{const value=process.env.SESSION_SECRET;if(!value||value.length<32)throw new HttpError(503,'Configure the same SESSION_SECRET on the dashboard and EA browser worker.');return value;}
export async function browserStatus(pool:Pick<pg.Pool,'query'>,year:number){
 const {rows}=await pool.query('SELECT phase,auto_enabled,heartbeat_at,interactive_until,frame_at,last_scan_at,last_error,rate_limit_until FROM futbot_ea_browser WHERE game_year=$1',[year]);
 const row=rows[0];return row?{...row,online:row.heartbeat_at&&Date.now()-new Date(row.heartbeat_at).getTime()<45000}:{phase:'disconnected',online:false,auto_enabled:false};
}
export async function enqueueBrowserAction(pool:Pick<pg.Pool,'connect'>,year:number,action:BrowserAction,secret:string):Promise<string>{
 const c=await pool.connect();try{
  await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(428111,$1)',[year]);
  const status=await c.query('SELECT phase,heartbeat_at,interactive_until,rate_limit_until FROM futbot_ea_browser WHERE game_year=$1',[year]);const row=status.rows[0];
  if(!row?.heartbeat_at||Date.now()-new Date(row.heartbeat_at).getTime()>45000)throw new HttpError(503,'EA browser worker is offline. Deploy the browser service first.');
  if(action.action==='scan'&&row.rate_limit_until&&new Date(row.rate_limit_until).getTime()>Date.now())throw new HttpError(429,'EA cooldown is active. Wait until the countdown finishes before checking again.');
  if(['click','text','key','scroll','reload'].includes(action.action)){
   if(row.phase==='checking')throw new HttpError(409,'A content check is running. Wait for it to finish.');
   if(!row.interactive_until||new Date(row.interactive_until).getTime()<=Date.now())throw new HttpError(409,'Open the connection screen first.');
  }
  const count=await c.query("SELECT count(*)::int AS n FROM futbot_ea_browser_commands WHERE game_year=$1 AND state='pending' AND expires_at>now()",[year]);if(Number(count.rows[0].n)>=10)throw new HttpError(429,'Wait for the browser to finish your previous actions.');
  const id=randomUUID();await c.query('INSERT INTO futbot_ea_browser_commands(id,game_year,action,payload_cipher) VALUES($1,$2,$3,$4)',[id,year,action.action,encrypt(JSON.stringify(action),secret)]);await c.query('COMMIT');return id;
 }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
}
export async function browserFrame(pool:Pick<pg.Pool,'query'>,year:number,secret:string){
 const {rows}=await pool.query('SELECT frame_cipher,frame_at,interactive_until FROM futbot_ea_browser WHERE game_year=$1',[year]);const row=rows[0];
 if(!row?.frame_cipher||new Date(row.interactive_until).getTime()<=Date.now()||Date.now()-new Date(row.frame_at).getTime()>20000)return {image:null};
 return {image:'data:image/jpeg;base64,'+decrypt(row.frame_cipher,secret),frameAt:new Date(row.frame_at).toISOString(),...EA_VIEWPORT};
}
