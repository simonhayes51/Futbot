import {isUnreleasedEvent,unreleasedRecords,unreleasedReason} from './content-watch-unreleased.js';
import {Readable,Transform,Writable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {parser} from 'stream-json';
import {pick} from 'stream-json/filters/pick.js';
import {streamArray} from 'stream-json/streamers/stream-array.js';
import {definitions,makeCapture,readHar,type Capture,type Document,type WatchState} from './content-watch.js';
import {HttpError} from './auth.js';
export const MAX_HAR_BYTES=200*1024*1024;
export function contentWatchOperator(userId:string):boolean{
 const owner=process.env.CONTENT_WATCH_USER_ID;return Boolean(owner&&/^\d{17,20}$/.test(owner)&&userId===owner);
}
/** Parse one HAR entry at a time. Raw captures and session headers are never saved. */
export async function streamHar(source:Readable,maxBytes=MAX_HAR_BYTES):Promise<Capture>{
 const documents:Document[]=[],publicUrls=new Set<string>();let bytes=0,depth=0,stringBytes=0,at='';
 const limit=new Transform({transform(chunk,encoding,done){bytes+=chunk.length;if(bytes>maxBytes)return done(new HttpError(413,'Choose a HAR smaller than 200 MB.'));done(null,chunk);}});
 const guard=new Transform({objectMode:true,transform(token,_encoding,done){
  if(token.name==='startObject'||token.name==='startArray'){if(++depth>128)return done(new HttpError(400,'HAR nesting is too deep.'));}
  if(token.name==='endObject'||token.name==='endArray')depth--;
  if(token.name==='startString'||token.name==='startKey')stringBytes=0;
  if(token.name==='stringChunk'){stringBytes+=Buffer.byteLength(token.value);if(stringBytes>16*1024*1024)return done(new HttpError(413,'An individual HAR field is too large.'));}
  done(null,token);
 }});
 try{await pipeline(source,limit,parser.asStream(),guard,pick.asStream({filter:'log.entries'}),streamArray.asStream(),new Writable({objectMode:true,write(item,_encoding,done){
  try{const capture=readHar({log:{entries:[item.value]}},true);documents.push(...capture.documents);for(const url of capture.publicUrls)publicUrls.add(url);if(capture.documents.length&&capture.capturedAt>at)at=capture.capturedAt;if(documents.length>5000)throw new HttpError(413,'Too many content responses in this HAR.');done();}catch(e){done(e as Error);}
 }}));}catch(e){if(e instanceof HttpError)throw e;throw new HttpError(400,'Could not read this HAR. Export a complete HAR with response content and try again.');}
 if(!documents.length)throw new HttpError(400,'No SBC or EVO responses found. Record the web app with response content included.');
 const capture=makeCapture(documents,[...publicUrls],at);if(!definitions(capture).length)throw new HttpError(400,'No SBC or EVO definitions found in this capture.');return capture;
}
export function watchSummary(state:WatchState,metadata:Record<string,unknown>){
 const records=Object.values(state.records),counts:Record<string,number>={};for(const r of records)counts[r.definition.kind]=(counts[r.definition.kind]??0)+1;
 return {ready:records.length>0,definitions:records.length,counts,coverage:state.coverage??null,publicSources:state.publicUrls.length,pendingAlerts:state.events.filter(e=>!e.delivered&&isUnreleasedEvent(state,e)).length,lastScan:state.lastRun??null,metadata,
  catalogueReview:records.filter(r=>r.definition.evidence==='catalogue-text').map(r=>({key:r.definition.key,name:r.definition.name,description:r.definition.description,source:r.definition.source})),
  unreleased:unreleasedRecords(state).map(r=>({key:r.definition.key,name:r.definition.name,kind:r.definition.kind,description:r.definition.description,rules:r.definition.rules,source:r.definition.source,firstSeen:r.firstSeen,reason:unreleasedReason(state,r.definition)})),
  recent:state.events.filter(e=>isUnreleasedEvent(state,e)).slice(-20).reverse().map(e=>({id:e.id,name:e.after.name,kind:e.after.kind,type:e.type,at:e.at,evidence:e.after.evidence}))};
}
