// SPDX-License-Identifier: AGPL-3.0-only
// Run with Electron on Windows. Uses blank local fixture windows, never real accounts.
const {app,BrowserWindow,ipcMain,WebContentsView}=require('electron');const fs=require('node:fs');const path=require('node:path');const os=require('node:os');const assert=require('node:assert/strict');
const fixture=Boolean(process.env.CHATBRIDGE_SMOKE_CHILD);
app.whenReady().then(async()=>{
 if(process.env.CHATBRIDGE_HOST_PIPE){
  const w=new BrowserWindow({show:false,width:1000,height:700,webPreferences:{preload:path.join(app.getAppPath(),'chatbridge/shell-preload.cjs'),sandbox:false,additionalArguments:['--chatbridge-signal-content']}});
  require(path.join(app.getAppPath(),'chatbridge/host.cjs')).installManagedSignal(w,require('electron'));
  await w.loadURL('data:text/html,<body>Signal window fixture</body>');
  const timer=setInterval(async()=>{if(!w.isVisible())return;clearInterval(timer);try{await require(path.join(app.getAppPath(),'input-roundtrip.cjs'))(w);fs.writeFileSync(path.join(app.getAppPath(),process.env.CHATBRIDGE_SIGNAL_PROFILE+'.input'),'pass');}catch(e){fs.writeFileSync(path.join(app.getAppPath(),process.env.CHATBRIDGE_SIGNAL_PROFILE+'.input'),e.stack);}},200);return;
 }
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cb-native-smoke-'));
 fs.cpSync(path.join(__dirname,'../extension'),path.join(directory,'chatbridge'),{recursive:true});
 fs.copyFileSync(__filename,path.join(directory,'fixture.cjs'));fs.copyFileSync(path.join(__dirname,'input-roundtrip.cjs'),path.join(directory,'input-roundtrip.cjs'));fs.writeFileSync(path.join(directory,'package.json'),JSON.stringify({name:'cb-native-test',main:'fixture.cjs'}));
 ipcMain.handle('chatbridge:invoke',(event,method,value)=>method==='edit'?require('../extension/input.cjs').edit(event.sender,value):method==='accounts'?[]:method==='signal-accounts'?{accounts:[],current:'default'}:undefined);
 const w=new BrowserWindow({show:false,width:1000,height:700,webPreferences:{preload:path.join(directory,'chatbridge/shell-preload.cjs'),sandbox:false,additionalArguments:['--chatbridge-signal-content']}});require('../extension/input.cjs').bindInput(w.webContents);await w.loadURL('data:text/html,<body>Default Signal fixture</body>');
 process.env.CHATBRIDGE_SMOKE_CHILD='1';
 const controller=require(path.join(directory,'chatbridge/host.cjs')).createNativeWorkspace(w,directory,require('electron'));
 const a='11111111-1111-1111-1111-111111111111',b='22222222-2222-2222-2222-222222222222';
 const wait=async predicate=>{const deadline=Date.now()+45000;while(!predicate()){if(Date.now()>deadline)throw Error('Native workspace timed out: '+JSON.stringify(controller.snapshot()));await new Promise(r=>setTimeout(r,100));}};
 try{
  await controller.open(b);
  await wait(()=>controller.snapshot().windows.length===2&&controller.snapshot().windows.every(r=>r.attached));
  const s=controller.snapshot();assert.equal(s.active,b);assert(s.windows.every(r=>r.actualParent===s.parent));
  assert.equal(new Set(s.windows.map(r=>r.pid)).size,2);
  await wait(()=>fs.existsSync(path.join(directory,b+'.input')));assert.equal(fs.readFileSync(path.join(directory,b+'.input'),'utf8'),'pass');console.log('CHILD_SIGNAL_OS_KEYBOARD_PASS');
  await controller.open(a);await wait(()=>fs.existsSync(path.join(directory,a+'.input')));assert.equal(fs.readFileSync(path.join(directory,a+'.input'),'utf8'),'pass');assert.equal(controller.snapshot().active,a);assert.equal(controller.snapshot().windows.length,3);console.log('SECOND_SIGNAL_OS_KEYBOARD_PASS');
  await controller.open('default');await wait(()=>w.isVisible());await require('./input-roundtrip.cjs')(w);console.log('DEFAULT_SIGNAL_OS_KEYBOARD_PASS');
  controller.hide();await wait(()=>!w.isVisible());const wa=new WebContentsView({webPreferences:{preload:path.join(directory,'chatbridge/shell-preload.cjs'),sandbox:false,additionalArguments:['--chatbridge-whatsapp']}});controller.host.contentView.addChildView(wa);wa.setBounds({x:144,y:108,width:700,height:500});require('../extension/input.cjs').bindInput(wa.webContents,controller.host);await wa.webContents.loadURL('data:text/html,<body>WhatsApp input fixture</body>');controller.host.focus();await require('./input-roundtrip.cjs')({webContents:wa.webContents});wa.webContents.close();console.log('WHATSAPP_VIEW_OS_KEYBOARD_PASS');
  controller.setSidebarWidth(104);await wait(()=>Math.abs(w.getContentSize()[0]-(controller.host.getContentSize()[0]-104))<=2);assert.equal(controller.snapshot().sidebarWidth,104);
  controller.hide();assert.equal(controller.snapshot().active,null);
  controller.close(b);assert(!controller.snapshot().windows.some(r=>r.id===b));
  console.log('NATIVE_WORKSPACE_SMOKE_PASS: three isolated processes attached to one parent; switching reuses windows');
  await controller.shutdown(false);console.log('NATIVE_WORKSPACE_SHUTDOWN_PASS');app.exit(0);
 }catch(e){console.error(e);await controller.shutdown(false);app.exit(1);}
}).catch(e=>{console.error(e);app.exit(1);});
