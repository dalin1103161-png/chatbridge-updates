// SPDX-License-Identifier: AGPL-3.0-only
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {bindInput,edit}=require('../extension/input.cjs');
test('editing targets the requesting page and rejects arbitrary native methods',()=>{
 const calls=[],page={copy:()=>calls.push('copy'),paste:()=>calls.push('paste')};
 edit(page,'copy');edit(page,'paste');assert.deepEqual(calls,['copy','paste']);
 for(const command of ['executeJavaScript','close','readText',null,{}])assert.throws(()=>edit(page,command));
});
test('mouse focus belongs to the clicked renderer without swallowing typing',()=>{
 const page=new EventEmitter();let focus=0,ignore;page.focus=()=>focus++;page.setIgnoreMenuShortcuts=x=>ignore=x;bindInput(page);
 page.emit('before-mouse-event',{}, {type:'mouseDown'});page.emit('before-mouse-event',{}, {type:'mouseMove'});
 assert.equal(focus,1);assert.equal(ignore,true);assert.equal(page.listenerCount('before-input-event'),0);
});
