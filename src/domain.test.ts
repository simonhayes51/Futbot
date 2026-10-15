import test from 'node:test';
import assert from 'node:assert/strict';
import {isFresh,meetsTarget,tradeProfit,escapeXml} from './domain.js';
test('targets include equality and distinguish buy/sell direction',()=>{assert(meetsTarget(100,100,'below'));assert(meetsTarget(100,100,'above'));assert(!meetsTarget(101,100,'below'));assert(!meetsTarget(99,100,'above'));});
test('stale and invalid source observations do not trigger alerts',()=>{const now=Date.now();assert(isFresh(new Date(now-299000),5,now));assert(!isFresh(new Date(now-301000),5,now));assert(!isFresh(new Date(NaN),5,now));assert(!isFresh(new Date(now+120000),5,now));});
test('profit includes EA tax for each copy',()=>{assert.deepEqual(tradeProfit(1000,1200,3),{tax:180,profit:420,breakEven:1053});});
test('card names cannot inject SVG markup',()=>assert.equal(escapeXml('<A&B>'),'&lt;A&amp;B&gt;'));
