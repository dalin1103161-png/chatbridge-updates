// SPDX-License-Identifier: AGPL-3.0-only
// Run with Electron on Windows. Uses blank local fixture windows, never real accounts.
const {app,BrowserWindow,ipcMain}=require('electron');const fs=require('node:fs');const path=require('node:path');const os=require('node:os');const assert=require('node:assert/strict');
const fixture=Boolean(process.env.CHATBRIDGE_SMOKE_CHILD);
app.whenReady().then(async()=>{
 if(process.env.CHATBRIDGE_HOST_PIPE){
  const w=new BrowserWindow({show:false,width:1000,height:700});
  require(path.join(app.getAppPath(),'chatbridge/host.cjs')).installManagedSignal(w,require('electron'));
  await w.loadURL('data:text/html,<body>Signal window fixture</body>');return;
 }
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'cb-native-smoke-'));
 fs.cpSync(path.join(__dirname,'../extension'),path.join(directory,'chatbridge'),{recursive:true});
 fs.copyFileSync(__filename,path.join(directory,'fixture.cjs'));fs.writeFileSync(path.join(directory,'package.json'),JSON.stringify({name:'cb-native-test',main:'fixture.cjs'}));
 ipcMain.handle('chatbridge:invoke',(_event,method)=>method==='accounts'?[]:method==='signal-accounts'?{accounts:[],current:'default'}:undefined);
 const w=new BrowserWindow({show:false,width:1000,height:700});await w.loadURL('data:text/html,<body>Default Signal fixture</body>');
 process.env.CHATBRIDGE_SMOKE_CHILD='1';
 const controller=require(path.join(directory,'chatbridge/host.cjs')).createNativeWorkspace(w,directory,require('electron'));
 const a='11111111-1111-1111-1111-111111111111',b='22222222-2222-2222-2222-222222222222';
 const wait=async predicate=>{const deadline=Date.now()+45000;while(!predicate()){if(Date.now()>deadline)throw Error('Native workspace timed out: '+JSON.stringify(controller.snapshot()));await new Promise(r=>setTimeout(r,100));}};
 try{
  await controller.open(a);await controller.open(b);
  await wait(()=>controller.snapshot().windows.length===3&&controller.snapshot().windows.every(r=>r.attached));
  const s=controller.snapshot();assert.equal(s.active,b);assert(s.windows.every(r=>r.actualParent===s.parent));
  assert.equal(new Set(s.windows.map(r=>r.pid)).size,3);
  await controller.open(a);assert.equal(controller.snapshot().active,a);assert.equal(controller.snapshot().windows.length,3);
  controller.setSidebarWidth(104);await wait(()=>Math.abs(w.getContentSize()[0]-(controller.host.getContentSize()[0]-104))<=2);assert.equal(controller.snapshot().sidebarWidth,104);
  controller.hide();assert.equal(controller.snapshot().active,null);
  controller.close(b);assert(!controller.snapshot().windows.some(r=>r.id===b));
  console.log('NATIVE_WORKSPACE_SMOKE_PASS: three isolated processes attached to one parent; switching reuses windows');
  await controller.shutdown(false);console.log('NATIVE_WORKSPACE_SHUTDOWN_PASS');app.exit(0);
 }catch(e){console.error(e);await controller.shutdown(false);app.exit(1);}
}).catch(e=>{console.error(e);app.exit(1);});
