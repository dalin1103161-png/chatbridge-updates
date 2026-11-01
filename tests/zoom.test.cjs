// SPDX-License-Identifier: AGPL-3.0-only
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {zoomState,bindZoom}=require('../extension/zoom.cjs');
test('zoom has safe bounds, defaults and explicit valid actions',()=>{
 assert.equal(zoomState(undefined).percent,100);assert.equal(zoomState(5).percent,100);
 assert.equal(zoomState(200,{action:'in'}).percent,200);assert.equal(zoomState(50,{action:'out'}).percent,50);
 assert.equal(zoomState(170,{action:'reset'}).percent,100);for(const v of [null,{}, {action:'bad'}])assert.throws(()=>zoomState(100,v),/无效/);
});
test('native shortcut and mouse-wheel requests change the bound page only',async()=>{
 const wc=Object.assign(new EventEmitter(),{isDestroyed:()=>false,setZoomMode:mode=>wc.mode=mode,setZoomFactor:factor=>wc.factor=factor,send:(name,state)=>wc.last={name,state}});
 let percent=100;const apply=bindZoom(wc,value=>{const s=zoomState(percent,value);percent=s.percent;return s;});
 assert.equal(wc.mode,'isolated');await apply();assert.equal(wc.factor,1);
 let prevented=false;wc.emit('before-input-event',{preventDefault:()=>prevented=true},{type:'keyDown',control:true,key:'+'});await apply();assert(prevented);assert.equal(wc.factor,1.1);
 wc.emit('zoom-changed',{},'out');await apply();assert.equal(wc.factor,1);
 wc.emit('before-input-event',{preventDefault(){}},{type:'keyDown',control:true,key:'0'});await apply();assert.equal(wc.factor,1);assert.equal(wc.last.name,'chatbridge:zoom');
});
