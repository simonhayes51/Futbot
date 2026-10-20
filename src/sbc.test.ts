import test from 'node:test';import assert from 'node:assert/strict';
import {fetchSbcPlayers,parseSbcDetail,parseSbcList} from './sbc.js';

test('SBC list only offers real challenge pages with a title',()=>{
 const rows=parseSbcList('<a href="/sbc/category/players/">Players</a><a href="/sbc/players/27-64-mls-future-stars-player-pick/"><h3>MLS Future Stars Player Pick</h3><p>Choose a player.</p></a><a href="/sbc/players/27-64-mls-future-stars-player-pick/"><h3>MLS Future Stars Player Pick</h3></a>');
 assert.equal(rows.length,1);assert.equal(rows[0].name,'MLS Future Stars Player Pick');assert.equal(rows[0].url,'/sbc/players/27-64-mls-future-stars-player-pick/');
});

test('SBC detail extracts expiry, requirements, rewards and the cheapest streamed route',()=>{
 const html='<title>FC 27 SBC - FUT.GG</title><script>set={id:71,name:"2x 83+ Upgrade",description:"Earn two 83+ players.",endTime:"2099-10-27T18:00:00Z",isRepeatable:!0,repeatRefreshIntervalText:"2 days",url:"/sbc/upgrades/27-71-2x-83-upgrade/",challenges:$R[21]=[$R[22]={id:14566,eaId:111,name:"2x 83+ Upgrade",description:"Earn a pack.",requirementsText:$R[24]=["Rating: Min. 45"],isStreamlined:!0,cheapestSolutionPrice:6300,awards:$R[25]=[$R[26]={pack:"2x 83+ Gold Players Pack"}]}],streamlinedSolutions:$R[29]={ps5:$R[32]={routes:$R[33]=[$R[34]={key:"cheapest",price:6300,score:5810,cards:7,groups:$R[35]=[$R[36]={overall:84,rarityEaId:0,count:7,price:6300,score:5810,unitPrice:900,unitScore:830}]}]},pc:$R[50]={routes:$R[51]=[$R[52]={key:"cheapest",price:7000,score:5810,cards:7,groups:$R[53]=[$R[54]={overall:84,rarityEaId:0,count:7,price:7000,score:5810,unitPrice:1000,unitScore:830}]}]}}}</script>';
 const row=parseSbcDetail(html,'https://www.fut.gg/sbc/upgrades/27-71-2x-83-upgrade/');
 assert.equal(row.name,'2x 83+ Upgrade');assert.equal(row.challenges.length,1);assert.equal(row.expires,null);
 assert.deepEqual(row.challenges[0].requirements,['Rating: Min. 45']);assert.equal(row.challenges[0].reward,'2x 83+ Gold Players Pack');
 assert.equal(row.challenges[0].price,6300);assert.equal(row.challenges[0].routes[0].groups[0].count,7);
 const pc=parseSbcDetail(html,'https://www.fut.gg/sbc/upgrades/27-71-2x-83-upgrade/','pc');assert.equal(pc.challenges[0].price,7000);
});

test('streamlined solver resolves the cheapest matching cards by name and price',async()=>{
 const html='<title>FC 27 SBC</title><script>set={name:"Upgrade",description:"",endTime:"2099-10-27T18:00:00Z",url:"/sbc/upgrades/27-71-2x-83-upgrade/",challenges:$R[1]=[$R[2]={eaId:111,name:"Upgrade",description:"",requirementsText:$R[3]=[],isStreamlined:!0}],streamlinedSolutions:$R[4]={ps5:$R[5]={routes:$R[6]=[$R[7]={key:"cheapest",price:1800,score:1660,cards:2,groups:$R[8]=[$R[9]={overall:84,rarityEaId:0,count:2,price:1800,score:1660,unitPrice:900,unitScore:830}]}]}}}</script>';
 const detail=parseSbcDetail(html,'https://www.fut.gg/sbc/upgrades/27-71-2x-83-upgrade/'),route=detail.challenges[0].routes[0];let requested='';
 const players=await fetchSbcPlayers(detail.url,detail.challenges[0],route,'ps5',async(input)=>{requested=String(input);return new Response(JSON.stringify({data:{players:[{player:{eaId:1,overall:84,commonName:'Player One',rarityName:'Rare'},price:900,gradingScore:830},{player:{eaId:2,overall:84,commonName:'Player Two',rarityName:'Rare'},price:900,gradingScore:830},{player:{eaId:3,overall:84,commonName:'Wrong rating',rarityName:'Rare'},price:800,gradingScore:700}]}}),{status:200});});
 assert.match(requested,/\/api\/fut\/sbc\/27\/27-71-2x-83-upgrade\/streamlined-solutions/);assert.equal(players.length,2);assert.deepEqual(players.map(p=>p.name),['Player One','Player Two']);
});

test('streamlined routes are matched to their challenge and oversized set totals are not shown as squads',()=>{
 const route=(price:number,cards:number)=>`$R[1]={key:"cheapest",price:${price},score:1000,cards:${cards},groups:$R[2]=[$R[3]={overall:84,rarityEaId:0,count:${cards},price:${price},score:1000,unitPrice:900,unitScore:830}]}`;
 const html=`<title>FC 27 SBC</title><script>set={name:"Upgrade Set",url:"/sbc/upgrades/27-71-upgrade-set/",challenges:$R[1]=[$R[2]={eaId:111,name:"Challenge One",isStreamlined:!0},$R[3]={eaId:222,name:"Challenge Two",isStreamlined:!0}],streamlinedSolutions:$R[4]={challenges:$R[5]=[$R[6]={challengeEaId:111,ps5:$R[7]={routes:$R[8]=[${route(22000,11)}]}},$R[9]={challengeEaId:222,ps5:$R[10]={routes:$R[11]=[${route(129270,139)}]}}]}}</script>`;
 const detail=parseSbcDetail(html,'https://www.fut.gg/sbc/upgrades/27-71-upgrade-set/');
 assert.equal(detail.challenges[0].routes[0].price,22000);
 assert.equal(detail.challenges[1].routes.length,0);
 assert.notEqual(detail.challenges[1].price,129270);
});
