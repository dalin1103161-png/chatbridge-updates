// SPDX-License-Identifier: AGPL-3.0-only
// Real packaged-app startup check, on a clean Windows CI user with no linked account.
const fs=require('node:fs');const path=require('node:path');const net=require('node:net');const {spawn}=require('node:child_process');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function cdp(url){const ws=new WebSocket(url);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});let id=0;const events=[];const waiting=new Map();ws.addEventListener('message',e=>{const p=JSON.parse(String(e.data));if(p.method&&/exceptionThrown|entryAdded/.test(p.method))events.push(p);const cb=waiting.get(p.id);if(cb){waiting.delete(p.id);p.error?cb.reject(Error(p.error.message)):cb.resolve(p.result);}});return {events,call(method,params={}){return new Promise((resolve,reject)=>{const n=++id;const timer=setTimeout(()=>{waiting.delete(n);reject(Error('CDP request timeout: '+method));},10000);waiting.set(n,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:e=>{clearTimeout(timer);reject(e);}});ws.send(JSON.stringify({id:n,method,params}));});},close:()=>ws.close()};}
(async()=>{
 const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
 const output=path.resolve('startup-diagnostics');fs.mkdirSync(output,{recursive:true});
 const env={...process.env};delete env.CHATBRIDGE_HOST_PIPE;delete env.CHATBRIDGE_HOST_TOKEN;delete env.CHATBRIDGE_SIGNAL_PROFILE;
 const app=spawn(path.resolve('signal-source/release/win-unpacked/ChatBridge.exe'),['--remote-debugging-address=127.0.0.1','--remote-debugging-port='+port],{env,stdio:['ignore','pipe','pipe']});
 const outputLog=fs.createWriteStream(path.join(output,'process.log'));app.stdout.pipe(outputLog,{end:false});app.stderr.pipe(outputLog,{end:false});
 let client,homeClient,homeVerified=false;
 try{
  const deadline=Date.now()+90000;let last={},loaded=false;
  while(Date.now()<deadline){
   try{
    const pages=await(await fetch('http://127.0.0.1:'+port+'/json/list')).json();
    const home=pages.find(p=>p.type==='page'&&p.url.includes('shell.html'));
    if(home&&!homeVerified){
     if(!homeClient)homeClient=await cdp(home.webSocketDebuggerUrl);
     const h=await homeClient.call('Runtime.evaluate',{expression:`!!document.querySelector('[data-chatbridge-home]')&&document.body.innerText.includes('各位销冠都开大单')&&!!document.querySelector('[data-cb-account="signal:default"] > button')`,returnByValue:true});
     if(h.result.value){homeVerified=true;const shot=await homeClient.call('Page.captureScreenshot');fs.writeFileSync(path.join(output,'homepage.png'),Buffer.from(shot.data,'base64'));await homeClient.call('Runtime.evaluate',{expression:`document.querySelector('[data-cb-account="signal:default"] > button').click()`});}
    }
    const page=pages.find(p=>p.type==='page'&&p.url.includes('background.html'));
    if(page){if(!client){client=await cdp(page.webSocketDebuggerUrl);await client.call('Runtime.enable');await client.call('Log.enable');}
     const r=await client.call('Runtime.evaluate',{expression:`JSON.stringify({ready:document.readyState,visible:document.visibilityState,text:document.querySelector('#app-container')?.innerText||'',toolbar:!!document.querySelector('[data-chatbridge-bar]'),automatic:/自动翻译已开启|Automatic translation is on/.test(document.querySelector('[data-chatbridge-bar]')?.innerText||''),switches:document.querySelectorAll('[data-chatbridge-bar] input[type=checkbox]').length,children:document.querySelector('#app-container')?.querySelectorAll('*').length||0,startApp:typeof window.startApp,signalContext:typeof window.SignalContext,loading:document.querySelector('#app-container')?.innerHTML?.slice(0,2000)})`,returnByValue:true});
     last=JSON.parse(r.result.value);
     if(last.ready==='complete'&&last.visible==='visible'&&last.toolbar&&last.automatic&&last.switches===0&&last.children>10&&/link|关联|扫描|device|QR|phone/i.test(last.text)){loaded=true;break;}
    }
   }catch(e){last.error=e.message;}
   await delay(1000);
  }
  fs.writeFileSync(path.join(output,'startup.json'),JSON.stringify({last,events:client?.events},null,2));
  if(!loaded&&client){const attempt=await client.call('Runtime.evaluate',{expression:`(()=>{try{window.startApp();return 'startApp called';}catch(e){return e.stack;}})()`,returnByValue:true});fs.writeFileSync(path.join(output,'start-attempt.json'),JSON.stringify(attempt,null,2));}
  if(client){const shot=await client.call('Page.captureScreenshot');fs.writeFileSync(path.join(output,'signal-login.png'),Buffer.from(shot.data,'base64'));}
  if(!homeVerified)throw Error('Packaged homepage did not become ready');
  if(!loaded)throw Error('Packaged Signal login did not become visible: '+JSON.stringify(last));
  console.log('PACKAGED_HOMEPAGE_PASS: homepage rendered and account navigation works');
  console.log('PACKAGED_SIGNAL_STARTUP_PASS: real Signal login content and translation toolbar visible');
 }finally{homeClient?.close();if(client){await client.call('Browser.close').catch(()=>{});client.close();}await delay(1000);if(app.exitCode===null)app.kill();outputLog.end();
 const logDir=path.join(process.env.APPDATA||'','ChatBridgeSignal','logs');if(fs.existsSync(logDir))for(const name of fs.readdirSync(logDir).filter(n=>n.endsWith('.log')))fs.copyFileSync(path.join(logDir,name),path.join(output,'signal-'+name));}
})().catch(e=>{console.error(e);process.exitCode=1;});
