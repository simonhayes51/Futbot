import test from 'node:test';
import assert from 'node:assert/strict';
import {parseManagers} from './misc-catalog.js';

test('manager catalogue maps FUT.GG artwork ids to full names',()=>{
 const html='<img src="https://game-assets.fut.gg/27/managers/portrait/1005571.cdbb85a361ba15ea.webp" alt="Diego Simeone">';
 assert.deepEqual(parseManagers(html),[{id:'1005571',name:'Diego Simeone'}]);
});

test('manager catalogue accepts FUTNext profile links without www',()=>{
 const html='<a href="https://futnext.com/managers/d-simeone/1005571"><span>M</span><strong>D. Simeone</strong></a>';
 assert.deepEqual(parseManagers(html),[{id:'1005571',name:'D. Simeone'}]);
});
