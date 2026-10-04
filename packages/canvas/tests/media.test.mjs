import {test} from 'node:test';
import assert from 'node:assert/strict';
import {parseMediaValue} from '../dist/index.js';
test('media parser preserves labels and IDs, freezes lists and rejects malformed or unbounded input',()=>{
 const value=parseMediaValue('[{"src":"https://example.com/a.png","alt":"Front"},{"id":"ada","name":"Ada Lovelace"}]');
 assert.equal(value[1].id,'ada');assert.equal(value[0].alt,'Front');assert.equal(Object.isFrozen(value),true);assert.equal(Object.isFrozen(value[0]),true);
 assert.deepEqual(parseMediaValue(''),[]);assert.equal(parseMediaValue('/image.png'),'/image.png');
 assert.throws(()=>parseMediaValue('[{"src":42}]'),/Invalid/);assert.throws(()=>parseMediaValue('[{"src":"a","extra":true}]'),/Invalid/);assert.throws(()=>parseMediaValue(JSON.stringify(Array(101).fill('a'))),/100/);
});
