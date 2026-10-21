import test from 'node:test';import assert from 'node:assert/strict';
import {parseTacticDetail,parseTacticList} from './tactics.js';
test('tactic list extracts formation ranks, popularity and import codes',()=>{
 const html='matches:$R[1]={community:$R[2]=[$R[3]={formationEaId:36,formationName:"4-2-1-3",formationDisplayName:"4-2-1-3",slug:"4-2-1-3",popularityRank:1,popularityPct:25.9,proUsagePct:16.7,buildUpName:"Balanced",defensiveName:"Balanced",lineHeight:60,shareCode:"HZjHoN5NRDz#"}]}';
 assert.deepEqual(parseTacticList(html),[{slug:'4-2-1-3',name:'4-2-1-3',rank:1,popularity:25.9,proUsage:16.7,buildUp:'Balanced',defense:'Balanced',lineHeight:60,shareCode:'HZjHoN5NRDz#'}]);
});
test('tactic detail reads community role and focus picks',()=>{
 const choice={slug:'4-2-1-3',name:'4-2-1-3',rank:1,popularity:25.9,proUsage:16.7,buildUp:'Balanced',defense:'Balanced',lineHeight:60,shareCode:'code'};
 const html='community:$R[1]={popularityRank:1,popularityPct:25.9,buildUpName:"Balanced",defensiveName:"Balanced",lineHeight:60,shareCode:"code",positionRoles:$R[2]=[$R[3]={positionIdx:0,positionUniqueId:0,positionName:"GK",roleId:442,roleName:"Goalkeeper",focusName:"Defend",focusDescription:"Stays on the line.",focusCharacteristics:$R[4]={plus:[]},focusSharePct:65,roleOptions:$R[5]=[],metarankId:1,heatmap:[]},$R[6]={positionIdx:1,positionUniqueId:3,positionName:"RB",roleId:440,roleName:"Fullback",focusName:"Defend",focusDescription:"Protects the goal.",focusCharacteristics:$R[7]={plus:[]},focusSharePct:45,roleOptions:$R[8]=[],metarankId:6,heatmap:[]}],proPositions:$R[9]={}}';
 const parsed=parseTacticDetail(html,choice);assert.equal(parsed.roles.length,2);assert.deepEqual(parsed.roles[0],{position:'GK',role:'Goalkeeper',focus:'Defend',share:65,description:'Stays on the line.'});assert.equal(parsed.roles[1].position,'RB');assert.equal(parsed.choice.proUsage,16.7);
});
