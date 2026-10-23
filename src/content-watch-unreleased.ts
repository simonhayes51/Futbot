import type {Definition,WatchState,Change} from './content-watch.js';
import {fingerprint} from './content-watch.js';
export type ReleaseCheck={status:'unreleased'|'released'|'ignore';at:string;until?:string;basis:string};
export function releaseCheck(state:WatchState,d:Definition,now=Date.now()):ReleaseCheck|undefined{
 const explicit=state.releaseChecks&&Object.hasOwn(state.releaseChecks,d.key)?state.releaseChecks[d.key]:undefined;if(explicit)return explicit;
 // The owner confirmed this specific item in the setup conversation on this date.
 // Do not generalise that confirmation to all Scream entries or later days.
 if(state.gameYear===27&&d.key==='evo-clue:pack-20304'&&d.name==='Twilight Screamer EVO Pack'&&new Date(now).toISOString().slice(0,10)==='2026-10-23')return {status:'unreleased',at:'2026-10-23',until:'2026-10-24T00:00:00Z',basis:'Owner confirmed unreleased on 23 October 2026'};
}
export function unreleasedReason(state:WatchState,d:Definition,now=Date.now()):string|undefined{
 const check=releaseCheck(state,d,now);
 if(check?.status==='released'||check?.status==='ignore')return;
 // Menu definitions are retained for comparison; they do not become leak alerts.
 if(d.evidence==='served-definition'){
  if(d.release&&Number.isFinite(d.release)&&d.release*1000>now)return 'EA release timestamp is in the future: '+new Date(d.release*1000).toISOString();
  return;
 }
 if(check?.status==='unreleased'&&check.until&&Date.parse(check.until)>now)return check.basis+' (checked '+check.at+')';
}
export function unreleasedRecords(state:WatchState,now=Date.now()){
 return Object.values(state.records).filter(r=>unreleasedReason(state,r.definition,now));
}
export function isUnreleasedEvent(state:WatchState,event:Change,now=Date.now()):boolean{
 const current=state.records[event.key];
 return Boolean(current&&unreleasedReason(state,current.definition,now)&&JSON.stringify(current.definition)===JSON.stringify(event.after));
}
export function queueUnreleased(state:WatchState,now=Date.now()):void{
 for(const row of unreleasedRecords(state,now)){
  const key=row.definition.key;
  if(state.events.some(e=>e.key===key&&JSON.stringify(e.after)===JSON.stringify(row.definition)))continue;
  state.events.push({id:fingerprint(['unreleased',key,row.hash]),key,at:new Date(now).toISOString(),type:'added',after:row.definition});
 }
}
export function assessRelease(state:WatchState,key:string,status:ReleaseCheck['status'],now=Date.now()):void{
 if(!Object.hasOwn(state.records,key))throw new Error('Content record not found.');
 if(!['unreleased','released','ignore'].includes(status))throw new Error('Invalid release status.');
 state.releaseChecks??={};state.releaseChecks[key]={status,at:new Date(now).toISOString(),until:status==='unreleased'?new Date(now+86400000).toISOString():undefined,basis:'Owner confirmed unreleased'};
 if(status==='unreleased')queueUnreleased(state,now);
}
