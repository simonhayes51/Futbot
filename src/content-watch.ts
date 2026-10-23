import {createHash} from 'node:crypto';

type Obj=Record<string,any>;
const obj=(v:unknown):Obj=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Obj:{};
const arr=(v:unknown):any[]=>Array.isArray(v)?v:[];
const num=(v:unknown):number|undefined=>typeof v==='number'&&Number.isFinite(v)?v:undefined;
const positions=['GK','SW','RWB','RB','RCB','CB','LCB','LB','LWB','RDM','CDM','LDM','RM','RCM','CM','LCM','LM','RAM','CAM','LAM','RF','CF','LF','RW','RS','ST','LS','LW'];
// Verified against AcademyEligibilityAttribute / Scope in the captured FC27 client.
const attributes=['NONE','OVR','PACE','SHOOTING','PASSING','DRIBBLING_MAIN','DEFENSE','PHYSICALITY','ACCELERATION','SPRINT_SPEED','AGILITY','BALANCE','JUMPING','STAMINA','STRENGTH','REACTIONS','AGGRESSION','COMPOSURE','INTERCEPTIONS','POSITIONING','VISION','BALL_CONTROL','CROSSING','DRIBBLING_SUB','FINISHING','FK_ACC','HEADING_ACC','LONG_PASSING','SHORT_PASSING','DEF_AWARENESS','SHOT_POWER','LONG_SHOTS','STANDING_TACKLE','SLIDING_TACKLE','VOLLEYS','CURVE','PENALTIES','WEAK_FOOT','SKILL_MOVES','ATTACK_WORK_RATE','DEFENSIVE_WORK_RATE','DEFINITION_ID','NATION','CLUB','LEAGUE','RARITY','RARITY_NEGATED','POSITION','POSITION_NEGATED','POSSIBLE_POSITIONS_COUNT','BASE_TRAITS_COUNT','ICON_TRAITS_COUNT','TOTAL_TRAITS_COUNT','BASE_TRAIT_PRESENT','ICON_TRAIT_PRESENT','UNTRADEABLE','PLAYER_ROLE_PLUS_PRESENT','PLAYER_ROLE_PLUSPLUS_PRESENT','PLAYER_ROLE_PLUS_COUNT','PLAYER_ROLE_PLUSPLUS_COUNT','PLAYER_ROLE_PLUS_OR_PLUSPLUS_TOTAL_COUNT','DEFINITION_ID_NEGATED','RARITY_GROUP','RARITY_GROUP_NEGATED'];
export type Rule={attribute:string;scope:'min'|'max'|'exact'|'between'|'unknown';targets:(number|string)[];raw?:unknown};
export type Definition={key:string;kind:'evo'|'sbc'|'sbc-challenge'|'evo-clue'|'evo-text';id:string;name:string;description:string;source:string;rules:Rule[];details:Obj;release?:number;expires?:number;evidence:'served-definition'|'catalogue-text'};
export type Document={url:string;capturedAt:string;body:unknown};
export type Capture={capturedAt:string;documents:Document[];publicUrls:string[];coverage:{evoExpected:number;evoFetched:number}};
export type Player={id:string;name:string;rating?:number;positions?:string[];stats?:Record<string,number>;basePlayStyles?:number;plusPlayStyles?:number;rarityId?:number;nationId?:number;leagueId?:number;definitionId?:number;skills?:number;weakFoot?:number;price?:number;priceCheckedAt?:string;platform?:string;gameYear?:number};
export type Match={player:Player;result:'eligible'|'ineligible'|'unverified';reasons:string[]};
export type Change={id:string;key:string;at:string;type:'added'|'changed';before?:Definition;after:Definition;delivered?:boolean};
export type WatchState={version:1;gameYear:number;publicUrls:string[];records:Record<string,{definition:Definition;hash:string;firstSeen:string;lastSeen:string}>;events:Change[];lastRun?:string;coverage?:Capture['coverage']};
export function emptyState(gameYear=27):WatchState{return {version:1,gameYear,publicUrls:[],records:{},events:[]};}
function canonical(v:unknown):unknown{if(Array.isArray(v))return v.map(canonical);if(v&&typeof v==='object')return Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,canonical(x)]));return v;}
export function fingerprint(v:unknown):string{return createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');}
export function publicContentUrl(value:string):boolean{try{const u=new URL(value);return u.origin==='https://www.ea.com'&&!u.username&&!u.password&&!u.search&&!u.hash&&/^\/ea-sports-fc\/ultimate-team\/web-app\/(?:loc\/en-US\.json|content\/[A-Za-z0-9-]+\/20\d{2}\/fut\/(?:loc\/companion\/futweb\/cdn\/en-US\.json|packs\/loc\/storepackdescriptions\.en_us\.xml))$/.test(u.pathname);}catch{return false;}}
function relevant(url:string):boolean{return /\/ut\/game\/fc\d+\/(?:academy\/(?:hub\/v2|category\/\d+)|sbs\/(?:hub\/v2|setId\/\d+\/challenges))$/.test(url)||publicContentUrl(url);}
export function readHar(payload:unknown):Capture{
 const documents:Document[]=[],publicUrls=new Set<string>();let capturedAt='';
 for(const e of arr(obj(obj(payload).log).entries)){
  const request=obj(e.request),response=obj(e.response),content=obj(response.content);let u:URL;try{u=new URL(request.url);}catch{continue;}
  if(request.method!=='GET'||response.status!==200||!relevant(u.origin+u.pathname)||typeof content.text!=='string')continue;
  const at=String(e.startedDateTime??'');if(!Number.isFinite(Date.parse(at)))continue;
  let text=content.text;if(content.encoding==='base64')text=Buffer.from(text,'base64').toString('utf8');text=text.replace(/^\uFEFF/,'');
  let body:unknown;try{body=u.pathname.endsWith('.xml')?text:JSON.parse(text);}catch{throw new Error('Invalid content response at '+u.pathname);}
  const url=u.origin+u.pathname;documents.push({url,capturedAt:at,body});if(publicContentUrl(url))publicUrls.add(url);if(at>capturedAt)capturedAt=at;
 }
 if(!documents.length)throw new Error('No supported EA SBC/EVO responses found. Export a HAR with response content.');
 return makeCapture(documents,[...publicUrls],capturedAt);
}
export function makeCapture(documents:Document[],publicUrls:string[]=[],capturedAt=new Date().toISOString()):Capture{
 if(!Number.isFinite(Date.parse(capturedAt)))throw new Error('Invalid capture timestamp');
 const expected=new Set<number>(),fetched=new Set<number>();
 for(const d of documents){if(!/\/academy\//.test(d.url))continue;for(const c of arr(obj(d.body).categories))for(const id of arr(c.slotIds))expected.add(id);for(const s of arr(obj(d.body).slots))if(typeof s.id==='number')fetched.add(s.id);}
 return {capturedAt,documents,publicUrls:publicUrls.filter(publicContentUrl),coverage:{evoExpected:expected.size,evoFetched:fetched.size}};
}
export function decodeRules(raw:unknown):Rule[]{
 const groups=new Map<number,Obj[]>();for(const r of arr(raw)){const group=groups.get(r.eligibilitySlot)??[];group.push(obj(r));groups.set(r.eligibilitySlot,group);}
 return [...groups.values()].map(rows=>{
  const attr=rows.find(r=>r.type==='PLAYER_ATTRIBUTE')?.eligibilityValue,scope=rows.find(r=>r.type==='SCOPE')?.eligibilityValue??2;
  let targets=rows.filter(r=>r.type==='ACADEMY_PLAYER_SLOTTING'||r.type==='ADDITIONAL_TARGET_VALUE').map(r=>r.eligibilityValue);
  const unknownTypes=rows.some(r=>!['PLAYER_ATTRIBUTE','SCOPE','ACADEMY_PLAYER_SLOTTING','ADDITIONAL_TARGET_VALUE'].includes(r.type));
  const attribute=unknownTypes?`UNKNOWN_${attr??'SBC'}`:attributes[attr]??`UNKNOWN_${attr??'SBC'}`;
  if(attribute==='POSITION'||attribute==='POSITION_NEGATED')targets=targets.map(n=>positions[n]??`UNKNOWN_POSITION_${n}`);
  return {attribute,scope:(['min','max','exact','between'] as const)[scope]??'unknown',targets,raw:rows.map(r=>({type:r.type,key:r.eligibilityKey,value:r.eligibilityValue}))};
 });
}
const cleanAward=(v:any)=>Object.fromEntries(['value','count','maxValue','priority','type','isUntradeable'].filter(k=>v[k]!==undefined).map(k=>[k,v[k]]));
export function xmlStrings(xml:string):Record<string,string>{
 const decode=(v:string)=>v.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&#(x[\da-f]+|\d+);|&(lt|gt|amp|quot|apos);/gi,(_,n,k)=>n?String.fromCodePoint(n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n)):({lt:'<',gt:'>',amp:'&',quot:'"',apos:"'"} as Record<string,string>)[k]);
 const out:Record<string,string>={};for(const m of xml.matchAll(/<trans-unit\b[^>]*\bresname="([^"]+)"[^>]*>[\s\S]*?<source\b[^>]*>([\s\S]*?)<\/source>[\s\S]*?<\/trans-unit>/g))out[decode(m[1])]=decode(m[2]);return out;
}
export function clueRules(text:string):Rule[]{
 const out:Rule[]=[];const rule=(attribute:string,scope:Rule['scope'],targets:(number|string)[])=>out.push({attribute,scope,targets});
 const rating=text.match(/rated\s+(\d+)\s+or lower/i),pace=text.match(/max\s+(\d+)\s+PAC/i),traits=text.match(/(\d+)\s+or (?:less|fewer) Base PlayStyles/i),pos=text.match(/with\s+([A-Z]{2,3})\s+position/),excluded=text.match(/excluding items with ([^.]+?) position/i);
 if(rating)rule('OVR','max',[+rating[1]]);if(pace)rule('PACE','max',[+pace[1]]);if(traits)rule('BASE_TRAITS_COUNT','max',[+traits[1]]);if(pos)rule('POSITION','exact',[pos[1]]);if(excluded)rule('POSITION_NEGATED','exact',excluded[1].match(/[A-Z]{2,3}/g)??[]);
 return out;
}
export function definitions(capture:Capture):Definition[]{
 const records=new Map<string,Definition>();
 for(const d of capture.documents){const b=obj(d.body),source=new URL(d.url).pathname;
  if(/\/academy\//.test(d.url))for(const s of arr(b.slots)){
   const key=`evo:${s.id}`;records.set(key,{key,kind:'evo',id:String(s.id),name:String(s.slotName??'Unnamed EVO'),description:String(s.slotDescription??''),source,rules:decodeRules(s.elgReqs),evidence:'served-definition',expires:num(s.endTime),details:{startBy:s.endTimePurchaseVisibility??null,category:s.categoryId??null,currencies:arr(s.currencies),gkOnly:s.isGkExclusive??false,outfieldOnly:s.isOutfieldExclusive??false,levels:arr(s.levels).map(l=>({level:l.level,awards:arr(l.awards).map(cleanAward),objectives:arr(l.objectives).map(o=>({name:o.name,multiplier:o.multiplier}))}))}});
  }
  if(/\/sbs\/hub\/v2$/.test(d.url))for(const c of arr(b.categories))for(const s of arr(c.sets)){
   const key=`sbc:${s.setId}`;records.set(key,{key,kind:'sbc',id:String(s.setId),name:String(s.name??'Unnamed SBC'),description:String(s.description??''),source,rules:[],evidence:'served-definition',release:num(s.releaseTime),details:{challenges:s.challengesCount,repeatability:s.repeatabilityMode,scoreRequirement:s.combinedChallengeScoreRequirement??null,awards:arr(s.awards).map(cleanAward)}});
  }
  if(/\/sbs\/setId\/\d+\/challenges$/.test(d.url))for(const s of arr(b.challenges)){
   const key=`sbc-challenge:${s.challengeId}`;records.set(key,{key,kind:'sbc-challenge',id:String(s.challengeId),name:String(s.name??'Unnamed SBC challenge'),description:String(s.description??''),source,rules:decodeRules(s.elgReq),evidence:'served-definition',details:{setId:s.setId,type:s.type,scoreRequirement:s.scoreRequirement??null,operation:s.elgOperation??'AND',rawRequirements:arr(s.elgReq),requirementsText:arr(s.elgDesc)}});
  }
  if(d.url.endsWith('.xml')&&typeof d.body==='string'){
   const strings=xmlStrings(d.body);for(const [k,description] of Object.entries(strings)){
    const m=k.match(/^FUT_STORE_PACK_(\d+)_DESC$/);if(!m||!/evolution consumable|evolution will be available|EVO pack/i.test(description+' '+strings[`FUT_STORE_PACK_${m[1]}_NAME`]))continue;
    const key=`evo-clue:pack-${m[1]}`;records.set(key,{key,kind:'evo-clue',id:m[1],name:strings[`FUT_STORE_PACK_${m[1]}_NAME`]??`Pack ${m[1]}`,description,source,rules:clueRules(description),evidence:'catalogue-text',details:{upgradesKnown:false,requirementsComplete:false,releaseKnown:false}});
   }
  }
  if(/\/loc\/.+en-US\.json$/.test(d.url)||/\/web-app\/loc\/en-US\.json$/.test(d.url))for(const [k,name] of Object.entries(b)){
   const m=k.match(/^AcademySlot(\d+)$/);if(!m||typeof name!=='string')continue;
   const key=`evo-text:${m[1]}`,description=typeof b[k+'Desc']==='string'?b[k+'Desc']:'';
   records.set(key,{key,kind:'evo-text',id:m[1],name,description,source,rules:clueRules(description),evidence:'catalogue-text',details:{upgradesKnown:false,requirementsComplete:false,releaseKnown:false}});
  }
 }
 return [...records.values()].sort((a,b)=>a.key.localeCompare(b.key));
}
export function applyCapture(state:WatchState,capture:Capture,baseline=false):Change[]{
 const changes:Change[]=[];
 const scoped={...capture,documents:capture.documents.filter(d=>{const m=d.url.match(/\/ut\/game\/fc(\d+)\//)??d.url.match(/\/content\/[^/]+\/20(\d{2})\/fut\//);return !m||Number(m[1])===state.gameYear;})};
 for(const definition of definitions(scoped)){
  const {source:ignoredSource,...content}=definition;
  const previous=state.records[definition.key],hash=fingerprint(content);
  if(previous&&previous.lastSeen>capture.capturedAt)continue;
  if(!baseline&&(!previous||previous.hash!==hash))changes.push({id:fingerprint([definition.key,hash,capture.capturedAt]),key:definition.key,at:capture.capturedAt,type:previous?'changed':'added',before:previous?.definition,after:definition});
  // Partial captures and public-only polls never delete unseen definitions.
  state.records[definition.key]={definition,hash,firstSeen:previous?.firstSeen??capture.capturedAt,lastSeen:capture.capturedAt};
 }
 state.publicUrls=[...new Set([...state.publicUrls,...capture.publicUrls])];state.lastRun=capture.capturedAt;
 if(capture.coverage.evoFetched)state.coverage=capture.coverage;
 state.events.push(...changes);return changes;
}
function compare(value:number,rule:Rule):boolean|undefined{const targets=rule.targets;if(targets.some(v=>typeof v!=='number')||!targets.length)return undefined;const [a,b]=targets as number[];switch(rule.scope){case 'min':return value>=a;case 'max':return value<=a;case 'exact':return value===a;case 'between':return b===undefined?undefined:value>=a&&value<=b;default:return undefined;}}
export function matchPlayer(definition:Definition,player:Player):Match{
 const reasons:string[]=[];let failed=false,unknown=false;
 if(!definition.rules.length){unknown=true;reasons.push('No decoded individual-player requirements');}
 if(definition.kind==='sbc'||definition.kind==='sbc-challenge'){unknown=true;reasons.push('SBC squad constraints need a squad solver; individual eligibility is not sufficient');}
 if(definition.evidence==='catalogue-text'){unknown=true;reasons.push('Partial catalogue clue: upgrades, release and complete eligibility unconfirmed');}
 if(definition.details.gkOnly===true&&(!player.positions||!player.positions.includes('GK'))){if(player.positions)failed=true;else unknown=true;reasons.push('Goalkeeper-only requirement');}
 if(definition.details.outfieldOnly===true){if(!player.positions){unknown=true;reasons.push('Missing positions for outfield-only check');}else if(player.positions.includes('GK')){failed=true;reasons.push('Outfield-only requirement');}}
 for(const r of definition.rules){let result:boolean|undefined;const a=r.attribute;
  if(a==='POSITION'||a==='POSITION_NEGATED'){
   if(player.positions&&r.targets.every(v=>typeof v==='string'&&positions.includes(v))){const present=r.targets.some(v=>player.positions!.includes(String(v)));result=a==='POSITION'?present:!present;}
  }else if(['RARITY','RARITY_NEGATED','NATION','LEAGUE','DEFINITION_ID_NEGATED'].includes(a)){
   const value=a.startsWith('RARITY')?player.rarityId:a==='NATION'?player.nationId:a==='LEAGUE'?player.leagueId:player.definitionId;
   if(value!==undefined){result=r.targets.includes(value);if(a.endsWith('NEGATED'))result=!result;}
  }else{
   const values:Record<string,number|undefined>={OVR:player.rating,BASE_TRAITS_COUNT:player.basePlayStyles,ICON_TRAITS_COUNT:player.plusPlayStyles,TOTAL_TRAITS_COUNT:player.basePlayStyles!==undefined&&player.plusPlayStyles!==undefined?player.basePlayStyles+player.plusPlayStyles:undefined,POSSIBLE_POSITIONS_COUNT:player.positions?.length,SKILL_MOVES:player.skills,WEAK_FOOT:player.weakFoot,DEFINITION_ID:player.definitionId,...player.stats};
   const value=values[a];if(value!==undefined)result=compare(value,r);
  }
  if(result===false){failed=true;reasons.push('Fails '+ruleText(r));}if(result===undefined){unknown=true;reasons.push('Cannot verify '+ruleText(r));}
 }
 return {player,result:failed?'ineligible':unknown?'unverified':'eligible',reasons};
}
export function ruleText(rule:Rule):string{return `${rule.attribute} ${rule.scope} ${rule.targets.join(', ')}`;}
export function shortlist(definition:Definition,players:Player[],platform:string,gameYear:number,maxAgeMinutes=15,now=Date.now()):Match[]{
 return players.filter(p=>p.platform===platform&&p.gameYear===gameYear).map(p=>matchPlayer(definition,p)).filter(m=>m.result!=='ineligible').map(m=>{
  const age=now-Date.parse(m.player.priceCheckedAt??'');if(!Number.isFinite(age)||age< -60000||age>maxAgeMinutes*60000||!Number.isFinite(m.player.price)||m.player.price!<=0){m.reasons.push('Missing or stale market price');m.player={...m.player,price:undefined};}return m;
 }).sort((a,b)=>(a.result==='eligible'?0:1)-(b.result==='eligible'?0:1)||(a.player.price??Infinity)-(b.player.price??Infinity)||a.player.id.localeCompare(b.player.id));
}
