import test from 'node:test';
import assert from 'node:assert/strict';
import {exactVersion,holographicCards,namedCard} from './futgg-cards.js';
import {evoText,shortUnlock} from './evo-copy.js';
test('holographic lookup requires an exact item and year, and keeps the finish',()=>{
 const data={data:[{eaId:100,game:'27',commonName:'Normal version',overall:80,itemVariants:[{eaId:16777316,game:'27',commonName:'Correct player',overall:85,rarityName:'Future Stars',holographicType:'holographic'}]}]};
 const holo=exactVersion(data,'16777316',27)!;assert.equal(holo.name,'Correct player');assert.equal(holo.id,'16777316');assert.equal(holo.rating,85);assert.equal(holo.rarity,'Future Stars · Holographic');
 assert.equal(exactVersion(data,'16777316',26),null);assert.equal(exactVersion(data,'33554532',27),null);
});
test('Evo copy expands source shorthand without hiding unlock requirements',()=>{
 assert.equal(evoText('PlayStyle: Gamechanger (^3)'),'PlayStyle: Gamechanger (cap 3)');
 assert.equal(evoText('Max PS: 2'),'Max PlayStyles: 2');
 assert.equal(shortUnlock('Shooting Practice [SP+ 28]: Unlocked by reaching level 28 in the Premium Season Pass.'),'Premium Season Pass · level 28 required');
});

test('public holographic catalogue supplies exact names and finishes without retaining owner data',()=>{
 const card={eaId:67114525,game:'27',commonName:'Holo name',overall:88,rarity:{name:'Icon'},holographicType:'holographic'};
 const result=holographicCards({data:{recent:[{username:'private',card:{userId:'secret',playerDef:card}}],valuable:[{playerDef:card}],catalogue:[{card:{...card,eaId:67119823,commonName:'Other card'}}]}},27);
 assert.equal(result.size,2);assert.equal(result.get('67114525')?.name,'Holo name');assert.match(result.get('67114525')!.rarity!,/Holographic/);assert(!JSON.stringify([...result.values()]).includes('private'));assert(!JSON.stringify([...result.values()]).includes('secret'));assert.equal(holographicCards({data:{catalogue:[{card}]}},26).size,0);
});

test('numeric feed placeholders are not mistaken for real player names',()=>{
 for(const name of ['67114525','Card #67114525','Player 67114525','Unknown card #67114525'])assert(!namedCard({id:'67114525',name,rating:null,position:null,rarity:null,club:null,image:null}));
 assert(namedCard({id:'67114525',name:'Real player name',rating:null,position:null,rarity:null,club:null,image:null}));
});
