import test from 'node:test';
import assert from 'node:assert/strict';
import {isMiscItemType,miscItemLabel} from './prices.js';

test('consumable categories are restricted to the supported FUT.GG groups',()=>{
  assert.equal(isMiscItemType('manager'),true);
  assert.equal(isMiscItemType('manager_league'),true);
  assert.equal(isMiscItemType('chemistry_style'),true);
  assert.equal(isMiscItemType('player'),false);
  assert.equal(isMiscItemType(null),false);
});

test('consumable labels preserve the FUT.GG source item ID',()=>{
  assert.equal(miscItemLabel('manager','1000047'),'Manager #1000047');
  assert.equal(miscItemLabel('manager_league','13'),'Manager league #13');
  assert.equal(miscItemLabel('chemistry_style','250'),'Chemistry style #250');
});
