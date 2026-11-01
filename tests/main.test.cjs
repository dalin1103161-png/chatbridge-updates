// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { installChatBridge, validTranslation } = require('../extension/main.cjs');

function fixture() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'chatbridge-'));
  const win = new EventEmitter();
  const actions = [];
  win.webContents = Object.assign(new EventEmitter(),{ id: 1, send: (...args) => actions.push(args),setZoomFactor:factor=>win.zoomFactor=factor,isDestroyed:()=>false });
  win.getContentSize = () => [1100, 800];
  win.contentView = { addChildView: () => {} };
  let handler, counter = 100;
  const launches=[];
  class View {
    constructor(options) {
      this.options = options;
      this.webContents = new EventEmitter();
      Object.assign(this.webContents, {
        id: counter++, getUserAgent: () => 'Mozilla/5.0 Chrome/140.0 Electron/39.0 ChatBridge/8.33.0',
        setUserAgent: ua => this.ua = ua, setWindowOpenHandler: () => {}, loadURL: url => this.url = url,
        isDestroyed: () => false, close: () => {}, send: () => {},setZoomFactor:factor=>this.zoomFactor=factor,
      });
    }
    setVisible(value) { this.visible = value; }
    setBounds(value) { this.bounds = value; }
  }
  const electron = { localTranslator:{translate:async(text,target)=>target+':'+text,close:()=>{}}, spawn: (exe,args,options)=>{launches.push({exe,args,options});return {on:()=>{},unref:()=>{}};}, app: { getPath: () => temp },
    ipcMain: { handle: (_, value) => handler = value, removeHandler: () => {} }, WebContentsView: View };
  const instance = installChatBridge(win, '/source', electron);
  return { temp, win, actions, launches, instance, invoke: (method, value, id = 1) => handler({ sender: { id } }, method, value),
    close() { win.emit('closed'); fs.rmSync(temp, { recursive: true, force: true }); } };
}

test('rejects empty, oversized and invalid translation requests', () => {
  for (const value of [{text:'',target:'en'}, {text:'x'.repeat(10001),target:'en'}, {text:'hi',target:'unsupported'}]) assert.throws(() => validTranslation(value));
});
test('denies unknown renderers before any action', async () => {
  const f = fixture(); try { await assert.rejects(f.invoke('accounts', null, 999), /权限/); } finally { f.close(); }
});
test('isolates two WhatsApp sessions and switches within the application', async () => {
  const f = fixture();
  try {
    const a = await f.invoke('add-whatsapp', 'Work');
    const b = await f.invoke('add-whatsapp', 'Personal');
    const va = f.instance.views.get(a.id), vb = f.instance.views.get(b.id);
    assert.notEqual(va.options.webPreferences.partition, vb.options.webPreferences.partition);
    assert.equal(va.visible, false); assert.equal(vb.visible, true);
    assert.equal(vb.url, 'https://web.whatsapp.com/');
    assert.equal(vb.bounds.y, 108);
    assert.equal(vb.bounds.x,144);
    assert(!vb.ua.includes('Electron/'));
    await f.invoke('signal'); assert.equal(vb.visible, false);
    const config = JSON.parse(fs.readFileSync(path.join(f.temp, 'chatbridge-whatsapp.json')));
    assert.equal(config.accounts.length, 2);
    assert(!JSON.stringify(config).includes('Subscription-Key'));
  } finally { f.close(); }
});
test('translation works without credentials or cloud setup',async()=>{const f=fixture();try{assert.equal(await f.invoke('translate',{text:'Hello',target:'zh-Hans'}),'zh-Hans:Hello');}finally{f.close();}});
test('WhatsApp page cannot change native account workspaces or settings', async () => {
  const f = fixture(); try {
    const a = await f.invoke('add-whatsapp', 'Work');
    const id = f.instance.views.get(a.id).webContents.id;
    await assert.rejects(f.invoke('add-whatsapp', 'Unexpected', id), /顶部/);
  } finally { f.close(); }
});

test('appearance preferences persist and reject writes from WhatsApp',async()=>{
 const f=fixture();try{
   const p={language:'en',theme:'violet',size:'large'};
   await f.invoke('preferences',p);
   assert.deepEqual(await f.invoke('preferences'),p);
   const a=await f.invoke('add-whatsapp','Work');
   await assert.rejects(f.invoke('preferences',p,f.instance.views.get(a.id).webContents.id),/设置/);
   await assert.rejects(f.invoke('preferences',{...p,size:'invalid'}),/无效/);
   assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.temp,'chatbridge-whatsapp.json'))).preferences,p);
 }finally{f.close();}
});

test('Signal accounts use separate persisted identities and launch selected profile only',async()=>{
 const f=fixture();try{
  const a=await f.invoke('add-signal','Work Signal');
  const b=await f.invoke('add-signal','Personal Signal');
  assert.notEqual(a.id,b.id);
  assert.equal(f.launches[0].options.env.CHATBRIDGE_SIGNAL_PROFILE,a.id);
  assert.equal(f.launches[1].options.env.CHATBRIDGE_SIGNAL_PROFILE,b.id);
  assert.equal(f.launches[0].options.env.ELECTRON_RUN_AS_NODE,undefined);
  const list=await f.invoke('signal-accounts');assert.equal(list.accounts.length,3);
  assert.equal(list.current,'default');
  await f.invoke('open-signal',a.id);assert.equal(f.launches.length,3);
  await f.invoke('open-signal','default');assert.equal(f.launches.length,3);
  await assert.rejects(f.invoke('open-signal','../outside'),/未知/);
  const wa=await f.invoke('add-whatsapp','WA');
  await assert.rejects(f.invoke('add-signal','Denied',f.instance.views.get(wa.id).webContents.id),/顶部/);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.temp,'ChatBridgeSignalAccounts',a.id+'.json'))).name,'Work Signal');
 }finally{f.close();}
});

test('account names and window title are editable without replacing login identities',async()=>{
 const f=fixture();try{
  const a=await f.invoke('add-whatsapp','Before');
  await f.invoke('rename-account',{platform:'whatsapp',id:a.id,name:'After'});
  assert.equal((await f.invoke('accounts'))[0].id,a.id);
  assert.equal((await f.invoke('accounts'))[0].name,'After');
  await f.invoke('rename-account',{platform:'signal',id:'default',name:'My Signal'});
  assert.equal((await f.invoke('signal-accounts')).accounts[0].name,'My Signal');
  await f.invoke('window-settings',{title:'Work Station',notifications:false,sound:false});
  assert.equal((await f.invoke('window-settings')).title,'Work Station');
  await assert.rejects(f.invoke('rename-account',{platform:'signal',id:'../outside',name:'No'}),/未知/);
 }finally{f.close();}
});

test('removing accounts persists the list change, closes WhatsApp view and rejects traversal',async()=>{
 const f=fixture();try{
  const wa=await f.invoke('add-whatsapp','Remove me');
  const sessionFile=path.join(f.temp,'keep-session-marker');fs.writeFileSync(sessionFile,'retained');
  await f.invoke('remove-account',{platform:'whatsapp',id:wa.id});
  assert.equal((await f.invoke('accounts')).length,0);assert.equal(f.instance.views.size,0);
  assert.equal(fs.readFileSync(sessionFile,'utf8'),'retained');
  const signal=await f.invoke('add-signal','Remove signal');
  await f.invoke('remove-account',{platform:'signal',id:signal.id});
  assert(!(await f.invoke('signal-accounts')).accounts.some(a=>a.id===signal.id));
  await f.invoke('remove-account',{platform:'signal',id:'default'});
  assert.equal((await f.invoke('signal-accounts')).accounts.length,0);
  await assert.rejects(f.invoke('remove-account',{platform:'signal',id:'../outside'}),/未知/);
 }finally{f.close();}
});


test('sidebar width repositions WhatsApp views, persists on release and rejects page writes',async()=>{
 const f=fixture();try{
  assert.equal((await f.invoke('sidebar-width')).width,144);const a=await f.invoke('add-whatsapp','Work');
  await f.invoke('sidebar-width',{width:112,persist:false});assert.equal(f.instance.views.get(a.id).bounds.x,112);assert.equal(f.instance.views.get(a.id).bounds.width,988);
  assert.equal(JSON.parse(fs.readFileSync(path.join(f.temp,'chatbridge-whatsapp.json'))).sidebarWidth,undefined);
  await f.invoke('sidebar-width',{width:112,persist:true});assert.equal(JSON.parse(fs.readFileSync(path.join(f.temp,'chatbridge-whatsapp.json'))).sidebarWidth,112);
  for(const width of [0,87,321,112.5])await assert.rejects(f.invoke('sidebar-width',{width,persist:true}),/无效/);
  await assert.rejects(f.invoke('sidebar-width',{width:100,persist:true},f.instance.views.get(a.id).webContents.id),/顶部/);
 }finally{f.close();}
});


test('chat zoom changes content scale per account, validates actions and persists preferences',async()=>{
 const f=fixture();try{
  const a=await f.invoke('add-whatsapp','A'),b=await f.invoke('add-whatsapp','B');const va=f.instance.views.get(a.id),vb=f.instance.views.get(b.id);
  assert.equal((await f.invoke('chat-zoom',undefined,va.webContents.id)).percent,100);
  await f.invoke('chat-zoom',{action:'in'},va.webContents.id);assert.equal(va.zoomFactor,1.1);assert.equal((await f.invoke('chat-zoom',undefined,vb.webContents.id)).percent,100);
  await f.invoke('chat-zoom',{action:'out'});assert.equal(f.win.zoomFactor,0.9);
  const stored=JSON.parse(fs.readFileSync(path.join(f.temp,'chatbridge-whatsapp.json'))).chatZoom;assert.equal(stored['whatsapp:'+a.id],110);assert.equal(stored['signal:default'],90);
  await assert.rejects(f.invoke('chat-zoom',{action:'invalid'},va.webContents.id),/无效/);
  await assert.rejects(f.invoke('chat-zoom',{action:'in'},999),/权限/);
  await f.invoke('chat-zoom',{action:'reset'},va.webContents.id);assert.equal(va.zoomFactor,1);
 }finally{f.close();}
});

test('unread counts mirror background account events without clearing when accounts are opened',async()=>{
 const f=fixture();try{const a=await f.invoke('add-whatsapp','One'),b=await f.invoke('add-whatsapp','Two');const va=f.instance.views.get(a.id),vb=f.instance.views.get(b.id);va.webContents.emit('page-title-updated',{},'(6) WhatsApp');await f.invoke('unread-report',9,vb.webContents.id);f.win.emit('chatbridge:signal-unread','default',4);await f.invoke('whatsapp',b.id);const state=await f.invoke('unread-state');assert.equal(state.find(e=>e.platform==='signal').count,4);assert.equal(state.find(e=>e.id===a.id).count,6);assert.equal(state.find(e=>e.id===b.id).count,9);await assert.rejects(f.invoke('unread-state',undefined,va.webContents.id));await assert.rejects(f.invoke('unread-report',2,1));await f.invoke('unread-report',0,vb.webContents.id);assert.equal((await f.invoke('unread-state')).find(e=>e.id===b.id).count,0);}finally{f.close();}
});

test('WhatsApp aggregate message counts take precedence over a smaller unread-chat title',async()=>{
 const f=fixture();try{const a=await f.invoke('add-whatsapp','One'),view=f.instance.views.get(a.id);let count=8;view.webContents.executeJavaScript=async()=>count;view.webContents.emit('did-finish-load');await new Promise(r=>setImmediate(r));view.webContents.emit('page-title-updated',{},'(2) WhatsApp');await f.invoke('unread-report',2,view.webContents.id);await new Promise(r=>setImmediate(r));assert.equal((await f.invoke('unread-state')).find(e=>e.id===a.id).count,8);count=0;view.webContents.emit('page-title-updated',{},'WhatsApp');await new Promise(r=>setImmediate(r));assert.equal((await f.invoke('unread-state')).find(e=>e.id===a.id).count,0);}finally{f.close();}
});
