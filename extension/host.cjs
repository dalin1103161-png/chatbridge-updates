// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const path=require('node:path');const net=require('node:net');const crypto=require('node:crypto');const readline=require('node:readline');const {spawn}=require('node:child_process');
const hwnd=w=>{const b=w.getNativeWindowHandle();return (b.length===8?b.readBigUInt64LE():BigInt(b.readUInt32LE())).toString();};
function createNativeWorkspace(signalWindow,rootDir,electron){
 const {BrowserWindow,screen,app}=electron;
 const host=new BrowserWindow({width:1280,height:900,minWidth:900,minHeight:650,title:'ChatBridge',backgroundColor:'#080e1a',autoHideMenuBar:true,webPreferences:{preload:path.join(rootDir,'chatbridge/shell-preload.cjs'),sandbox:false,contextIsolation:true,nodeIntegration:false}});
 host.loadFile(path.join(rootDir,'chatbridge/shell.html'));
 const pipe='\\\\.\\pipe\\chatbridge-'+crypto.randomUUID(),token=crypto.randomBytes(32).toString('hex');
 const windows=new Map(),children=new Map(),pending=new Map();let active=null,sequence=0,ready=false,closed=false,suspended=false;
 let rpc=async()=>{throw Error('Workspace is initializing');};
 const worker=spawn('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',path.join(rootDir,'chatbridge/native-window.ps1').replace(/app\.asar([\\/])/,'app.asar.unpacked$1')],{stdio:['pipe','pipe','pipe'],windowsHide:true});
 const report=state=>{if(!host.isDestroyed())host.webContents.send('chatbridge:workspace-status',state);};
 signalWindow.webContents.on('did-fail-load',(_e,code,description)=>report({error:'Signal 页面加载失败：'+code+' '+description}));
 signalWindow.webContents.on('render-process-gone',(_e,details)=>report({error:'Signal 页面进程退出：'+details.reason}));
 const error=message=>{if(!host.isDestroyed())host.webContents.send('chatbridge:launch-error',message);};
 worker.stdin.on('error',()=>{});
 worker.on('error',e=>error('内嵌窗口控制器启动失败：'+e.message));worker.stderr.on('data',()=>{});
 const command=record=>{if(!ready||closed)return;const [width,height]=host.getContentSize();const scale=screen.getDisplayMatching(host.getBounds()).scaleFactor;
  const id=++sequence;worker.stdin.write(JSON.stringify({id,parent:hwnd(host),child:record.hwnd,pid:record.pid,x:Math.round(200*scale),y:Math.round(108*scale),width:Math.round(Math.max(1,width-200)*scale),height:Math.round(Math.max(1,height-108)*scale),visible:record.id===active&&!suspended,attach:!record.attached})+'\n');pending.set(id,record);};
 readline.createInterface({input:worker.stdout}).on('line',line=>{try{const m=JSON.parse(line);if(m.ready){ready=true;for(const r of windows.values())command(r);return;}const r=pending.get(m.id);pending.delete(m.id);if(r?.complete){r.complete(m);return;}if(m.error)error('Signal 内嵌失败：'+m.error);else if(r){r.attached=true;r.actualParent=m.parent;applyElectronVisibility(r);}}catch{}});
 const layout=()=>{for(const r of windows.values())command(r);};
 for(const event of ['resize','move','show','restore'])host.on(event,layout);
 const applyElectronVisibility=record=>{
  if(!record?.attached||closed)return;
  const visible=record.id===active&&!suspended;
  if(record.electronVisible===visible)return;record.electronVisible=visible;
  if(record.id==='default'){if(visible)originalShow();else originalHide();}
  else {const client=[...clients].find(c=>c.chatbridgeProfile===record.id);if(client&&!client.destroyed)client.write(JSON.stringify({visibility:visible})+'\n');}
 };
 const attach=(id,handle,pid)=>{windows.set(id,{id,hwnd:handle,pid,attached:false});layout();};
 const originalShow=signalWindow.show.bind(signalWindow),originalHide=signalWindow.hide.bind(signalWindow);
 signalWindow.webContents.setBackgroundThrottling(false);
 signalWindow.hide();signalWindow.setMenuBarVisibility(false);signalWindow.setSkipTaskbar(true);attach('default',hwnd(signalWindow),process.pid);
 signalWindow.show=()=>layout();signalWindow.showInactive=()=>layout();
 signalWindow.on('show',layout);signalWindow.webContents.on('did-finish-load',layout);
 const clients=new Set();
 const server=net.createServer(socket=>{clients.add(socket);socket.once('close',()=>clients.delete(socket));let authenticated=false,profile='';const lines=readline.createInterface({input:socket});
  lines.on('line',async line=>{if(line.length>50000){socket.destroy();return;}try{const m=JSON.parse(line);
   if(!authenticated){const child=children.get(m.profile);if(m.token!==token||!child||child.pid!==m.pid||!/^\d+$/.test(m.hwnd)){socket.destroy();return;}authenticated=true;profile=m.profile;socket.chatbridgeProfile=profile;attach(profile,m.hwnd,m.pid);return;}
   if(m.shown){const record=windows.get(profile);if(record)command(record);return;}
   if(!['translate','copy','preferences'].includes(m.method))throw Error('Unsupported child request');
   const result=await rpc(m.method,m.value);if(!socket.destroyed)socket.write(JSON.stringify({id:m.id,result})+'\n');
  }catch(e){let id=0;try{id=JSON.parse(line).id;}catch{}if(authenticated&&!socket.destroyed)socket.write(JSON.stringify({id,error:e.message})+'\n');}});
  socket.on('error',()=>{});socket.on('close',()=>{if(profile){windows.delete(profile);children.delete(profile);}});
 });
 const listening=new Promise((resolve,reject)=>{server.once('error',reject);server.listen(pipe,resolve);});listening.catch(e=>error(e.message));
 let stopping;
 const shutdown=(quit=true)=>{
  if(stopping)return stopping;
  closed=true;
  stopping=(async()=>{
   const childrenToClose=[...children.values()];
   const detach=[...windows.values()].map(r=>new Promise(resolve=>{
    if(!ready||worker.killed){resolve();return;}
    const id=++sequence;pending.set(id,{complete:resolve});
    worker.stdin.write(JSON.stringify({id,parent:'0',child:r.hwnd,pid:r.pid,x:0,y:0,width:1,height:1,visible:false,attach:true})+'\n');
   }));
   await Promise.race([Promise.all(detach),new Promise(r=>setTimeout(r,4000))]);
   for(const client of clients)if(!client.destroyed)client.write(JSON.stringify({shutdown:true})+'\n');
   await Promise.race([Promise.all(childrenToClose.map(child=>new Promise(resolve=>{if(child.exitCode!==null)resolve();else child.once('exit',resolve);}))),new Promise(r=>setTimeout(r,8000))]);
   const remaining=childrenToClose.filter(c=>c.exitCode===null);
   if(remaining.length){closed=false;stopping=undefined;for(const record of windows.values())record.attached=false;layout();throw Error('账号仍在保存数据，关闭已暂停，请稍后重试。');}
   for(const client of clients)client.destroy();
   server.close();worker.stdin.end();worker.kill();windows.clear();children.clear();
   if(!host.isDestroyed())host.destroy();
   if(quit)app.quit();
  })();return stopping;
 };
 const controller={host,shutdown,snapshot:()=>({parent:hwnd(host),active,windows:[...windows.values()].map(r=>({...r}))}),defaultWebContents:signalWindow.webContents,setRPC:f=>rpc=f,
  async open(id){active=id;if(id==='default'||windows.has(id)){layout();return;}await listening;
   if(!children.has(id)){const env={...process.env,CHATBRIDGE_SIGNAL_PROFILE:id,CHATBRIDGE_HOST_PIPE:pipe,CHATBRIDGE_HOST_TOKEN:token};delete env.ELECTRON_RUN_AS_NODE;
    const child=spawn(app.getPath('exe'),app.isPackaged?[]:[rootDir],{env,stdio:'ignore',windowsHide:true});children.set(id,child);child.on('error',e=>{children.delete(id);error(e.message);});child.on('exit',()=>{children.delete(id);windows.delete(id);});}
   layout();
  },suspend(value){suspended=value;layout();},hide(){active=null;layout();},close(id){if(id==='default'){if(active===id)active=null;layout();return;}const child=children.get(id);if(child)child.kill();children.delete(id);windows.delete(id);},
 };
 host.on('close',event=>{event.preventDefault();shutdown().catch(e=>{error(e.message);app.quit();});});
 return controller;
}
function installManagedSignal(window,electron){
 const {ipcMain,app}=electron;window.setSkipTaskbar(true);window.setMenuBarVisibility(false);window.hide();
 const originalShow=window.show.bind(window),originalHide=window.hide.bind(window);window.webContents.setBackgroundThrottling(false);
 let electronVisible=false;
 let seq=0;const waiting=new Map();const socket=net.connect(process.env.CHATBRIDGE_HOST_PIPE);
 socket.once('connect',()=>socket.write(JSON.stringify({token:process.env.CHATBRIDGE_HOST_TOKEN,profile:process.env.CHATBRIDGE_SIGNAL_PROFILE,pid:process.pid,hwnd:hwnd(window)})+'\n'));
 window.show=()=>{if(socket.readyState==='open')socket.write(JSON.stringify({shown:true})+'\n');};window.showInactive=window.show;
 window.on('show',()=>{if(socket.readyState==='open')socket.write(JSON.stringify({shown:true})+'\n');});
 socket.on('error',()=>app.quit());socket.on('close',()=>app.quit());
 readline.createInterface({input:socket}).on('line',line=>{try{const m=JSON.parse(line);if(m.shutdown){app.quit();return;}if(typeof m.visibility==='boolean'){if(m.visibility!==electronVisible){electronVisible=m.visibility;if(m.visibility)originalShow();else originalHide();}return;}const p=waiting.get(m.id);if(p){waiting.delete(m.id);m.error?p.reject(Error(m.error)):p.resolve(m.result);}}catch{}});
 ipcMain.handle('chatbridge:invoke',(event,method,value)=>{if(event.sender.id!==window.webContents.id||!['translate','copy','preferences'].includes(method))throw Error('Unsupported child request');return new Promise((resolve,reject)=>{const id=++seq;waiting.set(id,{resolve,reject});socket.write(JSON.stringify({id,method,value})+'\n');});});
}
module.exports={createNativeWorkspace,installManagedSignal};
