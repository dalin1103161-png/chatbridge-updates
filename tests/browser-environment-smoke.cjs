// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
// Real Electron test. Synthetic sites and proxy are confined to this runner.
module.exports=async function(electron){
 const {BrowserWindow}=electron,assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
 const {createBrowserManager}=require('../extension/browser/manager.cjs');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cb-browser-smoke-')),w=new BrowserWindow({show:false,width:900,height:650}),views=[];
 function View(options){const v=new electron.WebContentsView(options);views.push({view:v,options});return v;}
 const server=http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end('<!doctype html><title>Local environment fixture</title><p id="language">'+String(req.headers['accept-language']||'').replace(/[<>]/g,'')+'</p>');});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));let m;try{
 const setup=()=>createBrowserManager({root,rootDir:path.join(__dirname,'..'),window:w,electron:{app:electron.app,session:electron.session,net:electron.net,safeStorage:electron.safeStorage,Menu:electron.Menu,WebContentsView:View},sidebarWidth:()=>144,lookupProxy:async()=>({ip:'203.0.113.10',timezone:'America/New_York',country:'US',latitude:40.7,longitude:-74})});
 m=setup();const call=(op,v={})=>m.handle({op,...v}),last=()=>[...views].reverse().find(x=>!x.view.webContents.isDestroyed()&&x.view.webContents.getURL().startsWith('http'));
 let s=await call('create',{name:'Environment A'}),id=s.active;
 await call('save-settings',{id,name:'Environment A',profile:{languageMode:'manual',language:'de-DE'},proxy:{enabled:true,protocol:'http',host:'127.0.0.1',port:server.address().port,username:'',password:'',autoTimezone:true}});
 s=await call('add-site',{id,adapter:'website',url:'http://fixture.invalid/one',name:'Account A'});const a=s.environments.find(x=>x.id===id),tab=a.activeTab,first=last();assert(!first.options.webPreferences.preload);assert.equal(first.options.webPreferences.nodeIntegration,false);
 await first.view.webContents.executeJavaScript("localStorage.setItem('test','A');document.cookie='fixture=A; Path=/'");
 s=await call('duplicate',{id,tab});const clone=last();assert.equal(clone.view.webContents.session,first.view.webContents.session);assert.equal(await clone.view.webContents.executeJavaScript("localStorage.getItem('test')"),'A');assert.equal(await clone.view.webContents.executeJavaScript('document.cookie'),'fixture=A');
 s=await call('add-site',{id,adapter:'website',url:'http://fixture.invalid/one',name:'Account B'});const second=last();assert.notEqual(second.view.webContents.session,first.view.webContents.session);assert.equal(await second.view.webContents.executeJavaScript("localStorage.getItem('test')"),null);assert.equal(await second.view.webContents.executeJavaScript('document.cookie'),'');
 assert((await second.view.webContents.session.resolveProxy('https://example.test/')).includes('127.0.0.1:'+server.address().port));assert.equal(await second.view.webContents.executeJavaScript('Intl.DateTimeFormat().resolvedOptions().timeZone'),'America/New_York');assert.match(await second.view.webContents.executeJavaScript("document.querySelector('#language').textContent"),/^de-DE/i);console.log('ENVIRONMENT_SHARED_PROXY_AND_SETTINGS_PASS');
 const checked=await call('diagnose',{id});console.log('ENVIRONMENT_LANGUAGE_OBSERVED',JSON.stringify(checked.values[0]?.observed?.languages));assert(checked.consistent,'Environment language/timezone checks should agree');
 await call('add-tab',{id,accountId:a.accounts[0].id,url:'http://other.invalid/two'});const other=last();assert.equal(await other.view.webContents.executeJavaScript("localStorage.getItem('test')"),null);assert.equal(await other.view.webContents.executeJavaScript('document.cookie'),'');
 s=await call('create',{name:'Environment B'});const id2=s.active;await call('add-site',{id:id2,adapter:'website',url:'http://127.0.0.1:'+server.address().port+'/direct',name:'Other environment'});const isolated=last();assert.notEqual(isolated.view.webContents.session,first.view.webContents.session);assert(!(await isolated.view.webContents.session.resolveProxy('https://example.test/')).includes('127.0.0.1:'+server.address().port));
 s=await call('activate',{id,tab});const before=s.environments.find(x=>x.id===id);m.close();m=setup();s=await call('restore');const after=s.environments.find(x=>x.id===id);assert.equal(s.active,id);assert.equal(after.revision,before.revision);assert.deepEqual(after.tabs.map(t=>t.id),before.tabs.map(t=>t.id));assert.equal(after.activeTab,tab);assert.equal(await last().view.webContents.executeJavaScript("localStorage.getItem('test')"),'A');
 console.log('ENVIRONMENT_TAB_SESSION_ISOLATION_AND_RESTORE_PASS');
 }finally{m?.close();w.destroy();server.closeAllConnections();await new Promise(r=>server.close(r));}
};
