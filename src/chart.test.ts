import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import {marketChart} from './chart.js';
test('Discord chart is a valid PNG and missing series is omitted',async()=>{
 assert.equal(await marketChart('No data',[]),null);
 const png=await marketChart('Lavia <demo>',[{at:new Date('2026-10-15T12:00:00Z'),value:800},{at:new Date('2026-10-15T13:00:00Z'),value:850}]);
 const meta=await sharp(png!).metadata();assert.equal(meta.format,'png');assert.equal(meta.width,780);
});
