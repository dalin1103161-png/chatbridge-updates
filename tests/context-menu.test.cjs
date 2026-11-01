// SPDX-License-Identifier: AGPL-3.0-only
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {bindContextMenu}=require('../extension/context-menu.cjs');
test('image context menu copies the displayed image at the clicked coordinates without fetching URLs',()=>{
 const wc=new EventEmitter(),owner={};let copied,menu,popup;wc.copyImageAt=(...args)=>copied=args;wc.isDestroyed=()=>false;
 bindContextMenu(wc,owner,{buildFromTemplate:items=>(menu=items,{popup:opts=>popup=opts})});
 wc.emit('context-menu',{}, {mediaType:'image',hasImageContents:true,x:123,y:45,srcURL:'blob:private'});
 assert.equal(menu[0].label,'复制图片 / Copy image');assert.equal(popup.window,owner);menu[0].click();assert.deepEqual(copied,[123,45]);
 copied=null;wc.isDestroyed=()=>true;menu[0].click();assert.equal(copied,null);
});
test('empty images offer no image copy and editable contexts retain text editing actions',()=>{
 const wc=new EventEmitter();let menu,count=0;const calls=[];for(const key of ['copy','cut','paste','focus','selectAll'])wc[key]=()=>calls.push(key);
 bindContextMenu(wc,{}, {buildFromTemplate:items=>(count++,menu=items,{popup(){}})});
 wc.emit('context-menu',{}, {mediaType:'image',hasImageContents:false,x:0,y:0});assert.equal(count,0);
 wc.emit('context-menu',{}, {mediaType:'none',isEditable:true,selectionText:'selected',editFlags:{canCopy:true,canPaste:true}});menu[0].click();menu.find(i=>i.label.startsWith('粘贴')).click();assert.deepEqual(calls,['copy','focus','paste']);
});
