// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createStore,profile}=require('../extension/browser/store.cjs'),adapters=require('../extension/browser/adapters.cjs'),engine=require('../extension/browser/profile.cjs');
function withStore(fn){const root=fs.mkdtempSync(path.join(os.tmpdir(),'cb-env-'));try{return fn(createStore(root,adapters),root);}finally{fs.rmSync(root,{recursive:true,force:true});}}
test('duplicates share exactly the original account while distinct accounts and environments have separate storage',()=>withStore((s)=>{
 const env=s.create('One'),other=s.create('Two');const first=s.addSite(env.id,{adapter:'website',url:'https://example.test/',name:'First'}),original=first.tabs[0];
 const copy=s.duplicate(env.id,original.id);assert.equal(copy.tabs[1].accountId,original.accountId);assert.notEqual(copy.tabs[1].id,original.id);
 const next=s.addSite(env.id,{adapter:'website',url:'https://example.test/',name:'Second'}),separate=s.addSite(other.id,{adapter:'website',url:'https://example.test/',name:'First'});
 assert.notEqual(next.tabs[2].accountId,original.accountId);assert.equal(new Set([s.sessionPath(env.id,original.accountId),s.sessionPath(env.id,next.tabs[2].accountId),s.sessionPath(other.id,separate.tabs[0].accountId)]).size,3);assert.throws(()=>s.sessionPath(other.id,original.accountId));
}));
test('tab URLs, order, active tab, profile revision and account metadata survive reopen without regenerating IDs',()=>withStore((s,root)=>{
 let e=s.create('Workspace');e=s.addSite(e.id,{adapter:'whatsapp',name:'WS 1',platform:'WS',note:'Work'});e=s.addSite(e.id,{adapter:'website',url:'https://example.test/next',name:'Docs'});s.move(e.id,e.tabs[1].id,0);s.select(e.id);
 const stored=s.edit(e.id,x=>{x.profile=profile({languageMode:'manual',language:'de-DE'});},{settings:true});const restored=createStore(root,adapters);assert.equal(restored.selected(),e.id);assert.deepEqual(restored.get(e.id),stored);
 const tab=stored.tabs[0],closed=restored.close(e.id,tab.id);assert.equal(closed.tabs.length,1);assert(closed.accounts.some(a=>a.id===tab.accountId));assert.equal(closed.revision,stored.revision);
}));
test('bad URLs, path traversal, nonexistent session references and unsupported adapters cannot enter storage',()=>withStore(s=>{
 const e=s.create('Safe');for(const v of [{adapter:'website',url:'file:///C:/Windows/'},{adapter:'website',url:'javascript:alert(1)'},{adapter:'website',url:'https://user:pass@example.test/'},{adapter:'whatsapp',url:'https://example.test/'},{adapter:'signal',url:'https://example.test/'},{adapter:'constructor',url:'https://example.test/'}])assert.throws(()=>s.addSite(e.id,v));assert.throws(()=>s.get('../Signal'));assert.throws(()=>s.addTab(e.id,e.id,'https://example.test/'));assert.equal(s.get(e.id).tabs.length,0);
}));
test('recover a corrupt environment from its valid backup without treating a future schema as writable',()=>withStore((s,root)=>{
 const e=s.create('One');s.edit(e.id,x=>x.name='Two');const file=path.join(root,e.id,'environment.json');fs.writeFileSync(file,'{broken');const recovered=createStore(root,adapters);assert.equal(recovered.get(e.id).name,'One');assert(recovered.errors.length);assert.equal(fs.readFileSync(file,'utf8'),'{broken');fs.writeFileSync(file,JSON.stringify({...e,schemaVersion:2}));assert.throws(()=>createStore(root,adapters).get(e.id));
}));
test('derive coherent language and approximate position from the environment network without random values',()=>{
 const p=profile({languageMode:'ip',geoMode:'ip'}),net={country:'DE',timezone:'Europe/Berlin',latitude:52.5,longitude:13.4};const r=engine.resolve(p,net,'en-US');assert.deepEqual(r,{language:'de-DE',timezone:'Europe/Berlin',geo:{latitude:52.5,longitude:13.4,accuracy:50000},languageFallback:false});assert.deepEqual(engine.resolve(p,net,'en-US'),r);assert.throws(()=>engine.resolve(p,{country:'DE'},'en-US'),/坐标/);assert.throws(()=>profile({geoMode:'manual',latitude:100,longitude:0}));
});
