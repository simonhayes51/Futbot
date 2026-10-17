import assert from 'node:assert/strict';
import test from 'node:test';
import {validateFeed} from './feeds.js';

test('validates a scheduled consumables feed',()=>{
 const feed=validateFeed({kind:'consumables',name:'Daily consumables',channel_id:'123456789012345678',times:['18:05'],timezone:'Europe/London',enabled:true});
 assert.equal(feed.kind,'consumables');
 assert.equal(feed.list_id,null);
 assert.equal(feed.enabled,true);
});
