import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {marketChart,chartSeries} from './chart.js';
test('Discord chart is a valid PNG and missing series is omitted',async()=>{
 assert.equal(await marketChart('No data',[]),null);
 const png=await marketChart('Lavia <demo>',[{at:new Date('2026-10-15T12:00:00Z'),value:800},{at:new Date('2026-10-15T13:00:00Z'),value:850}]);
 const meta=await sharp(png!).metadata();assert.equal(meta.format,'png');assert.equal(meta.width,780);
});

test('chart filters invalid samples and sorts observations chronologically',()=>{const at=new Date('2026-10-15T00:00:00Z');assert.deepEqual(chartSeries([{at:new Date(at.getTime()+3600000),value:20},{at,value:10},{at,value:NaN},{at,value:0}]).map(p=>p.value),[10,20]);});
test('flat price series renders and duplicate times are omitted',async()=>{const at=new Date('2026-10-15T00:00:00Z');assert.equal(await marketChart('duplicate',[{at,value:1},{at,value:2}]),null);assert(await marketChart('flat',[{at,value:10},{at:new Date(at.getTime()+3600000),value:10}]));});
