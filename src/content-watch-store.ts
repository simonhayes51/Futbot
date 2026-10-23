import type pg from 'pg';
import {emptyState,type WatchState} from './content-watch.js';
export type WatchMetadata={lastUploadAt?:string;lastUploadMode?:string;lastPublicPollAt?:string;lastPollError?:string|null;lastAuthenticatedScanAt?:string;lastAuthenticatedSbcCoverage?:{expected:number;fetched:number};lastAuthenticatedWarnings?:string[]};
export class WatchBusy extends Error{}
export async function databaseWatch<T>(pool:Pick<pg.Pool,'connect'>,year:number,work:(state:WatchState,save:()=>Promise<void>,metadata:WatchMetadata)=>Promise<T>):Promise<T>{
 const client=await pool.connect();let locked=false;
 try{
  const lock=await client.query('SELECT pg_try_advisory_lock(428109,$1) AS locked',[year]);locked=lock.rows[0]?.locked===true;
  if(!locked)throw new WatchBusy('The monitor is busy. Try again shortly.');
  const {rows}=await client.query('SELECT state,metadata FROM futbot_content_watch WHERE game_year=$1',[year]);
  const state:WatchState=rows[0]?.state??emptyState(year),metadata:WatchMetadata=rows[0]?.metadata??{};
  if(state.version!==1||state.gameYear!==year)throw new Error('Incompatible content-watch state');
  const save=async()=>{await client.query('INSERT INTO futbot_content_watch(game_year,state,metadata) VALUES($1,$2,$3) ON CONFLICT(game_year) DO UPDATE SET state=EXCLUDED.state,metadata=EXCLUDED.metadata,updated_at=now()',[year,state,metadata]);};
  return await work(state,save,metadata);
 }finally{if(locked)await client.query('SELECT pg_advisory_unlock(428109,$1)',[year]).catch(()=>{});client.release();}
}
export async function readDatabaseWatch(pool:Pick<pg.Pool,'query'>,year:number):Promise<{state:WatchState;metadata:WatchMetadata}>{
 const {rows}=await pool.query('SELECT state,metadata FROM futbot_content_watch WHERE game_year=$1',[year]);return {state:rows[0]?.state??emptyState(year),metadata:rows[0]?.metadata??{}};
}
