// SPDX-License-Identifier: AGPL-3.0-only
// Real packaged-app startup check, on a clean Windows CI user with no linked account.
const fs=require('node:fs');const path=require('node:path');const net=require('node:net');const {spawn}=require('node:child_process');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
async function cdp(url){const ws=new WebSocket(url);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true});});let id=0;const events=[];const waiting=new Map();ws.addEventListener('message',e=>{const p=JSON.parse(String(e.data));if(p.method&&/exceptionThrown|entryAdded/.test(p.method))events.push(p);const cb=waiting.get(p.id);if(cb){waiting.delete(p.id);p.error?cb.reject(Error(p.error.message)):cb.resolve(p.result);}});return {events,call(method,params={}){return new Promise((resolve,reject)=>{const n=++id;const timer=setTimeout(()=>{waiting.delete(n);reject(Error('CDP request timeout: '+method));},10000);waiting.set(n,{resolve:value=>{clearTimeout(timer);resolve(value);},reject:e=>{clearTimeout(timer);reject(e);}});ws.send(JSON.stringify({id:n,method,params}));});},close:()=>ws.close()};}
(async()=>{
 const port=await new Promise(resolve=>{const s=net.createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>resolve(p));});});
 const output=path.resolve('startup-diagnostics',process.env.CHATBRIDGE_STARTUP_LABEL||'run');fs.mkdirSync(output,{recursive:true});
 const env={...process.env,WAYLAND_DISPLAY:'wayland-test',XDG_SESSION_TYPE:'wayland'};delete env.CHATBRIDGE_HOST_PIPE;delete env.CHATBRIDGE_HOST_TOKEN;delete env.CHATBRIDGE_SIGNAL_PROFILE;
 const app=spawn(path.resolve('signal-source/release/linux-unpacked/chatbridge'),['--no-sandbox','--ozone-platform=x11','--disable-gpu','--disable-dev-shm-usage','--remote-debugging-address=127.0.0.1','--remote-debugging-port='+port],{env,stdio:['ignore','pipe','pipe']});
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
     if(h.result.value){
      const header=await homeClient.call('Runtime.evaluate',{expression:`(()=>{const bar=document.querySelector('[data-chatbridge-bar]').getBoundingClientRect(),actions=document.querySelector('[data-cb-workspace-actions]').getBoundingClientRect(),main=document.querySelector('main').getBoundingClientRect();return {top:bar.top,bottom:bar.bottom,actionsTop:actions.top,actionsBottom:actions.bottom,mainTop:main.top};})()`,returnByValue:true});
      const rect=header.result.value;if(rect.top!==0||rect.bottom!==48||rect.actionsTop<0||rect.actionsBottom>48||rect.mainTop!==48)throw Error('Workspace header does not fit the compact top area: '+JSON.stringify(rect));
      console.log('PACKAGED_COMPACT_WORKSPACE_HEADER_PASS');
      const size=await homeClient.call('Runtime.evaluate',{expression:`Number(document.querySelector('[data-cb-resizer]').getAttribute('aria-valuenow'))`,returnByValue:true});
      const initial=size.result.value,targetWidth=initial<120?168:108;
      await homeClient.call('Input.dispatchMouseEvent',{type:'mousePressed',x:initial-4,y:250,button:'left',buttons:1,clickCount:1});
      for(let step=1;step<=4;step++)await homeClient.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:initial-4+(targetWidth-initial)*step/4,y:250,button:'left',buttons:1});
      await homeClient.call('Input.dispatchMouseEvent',{type:'mouseReleased',x:targetWidth-4,y:250,button:'left',buttons:0,clickCount:1});
      const resized=await homeClient.call('Runtime.evaluate',{expression:`Math.round(document.querySelector('[data-cb-sidebar]').getBoundingClientRect().width)`,returnByValue:true});
      if(resized.result.value!==targetWidth)throw Error('Sidebar mouse drag did not update its width');
      console.log('PACKAGED_SIDEBAR_DRAG_PASS',initial,'to',targetWidth);homeVerified=true;const shot=await homeClient.call('Page.captureScreenshot');fs.writeFileSync(path.join(output,'homepage.png'),Buffer.from(shot.data,'base64'));await homeClient.call('Runtime.evaluate',{expression:`document.querySelector('[data-cb-account="signal:default"] > button').click()`});}
    }
    const page=pages.find(p=>p.type==='page'&&p.url.includes('background.html'));
    if(page){if(!client){client=await cdp(page.webSocketDebuggerUrl);await client.call('Runtime.enable');await client.call('Log.enable');}
     const r=await client.call('Runtime.evaluate',{expression:`JSON.stringify({ready:document.readyState,visible:document.visibilityState,text:document.querySelector('#app-container')?.innerText||'',toolbar:!!document.querySelector('[data-chatbridge-bar]'),automatic:/自动翻译已开启|Automatic translation is on/.test(document.querySelector('[data-chatbridge-bar]')?.innerText||''),switches:document.querySelectorAll('[data-chatbridge-bar] input[type=checkbox]').length,children:document.querySelector('#app-container')?.querySelectorAll('*').length||0,startApp:typeof window.startApp,signalContext:typeof window.SignalContext,loading:document.querySelector('#app-container')?.innerHTML?.slice(0,2000)})`,returnByValue:true});
     last=JSON.parse(r.result.value);
     if(last.ready==='complete'&&last.visible==='visible'&&!last.toolbar&&last.switches===0&&last.children>10&&/link|关联|扫描|device|QR|phone/i.test(last.text)){loaded=true;break;}
    }
   }catch(e){last.error=e.message;}
   await delay(1000);
  }
  fs.writeFileSync(path.join(output,'startup.json'),JSON.stringify({last,events:client?.events},null,2));
  if(!loaded&&client){const attempt=await client.call('Runtime.evaluate',{expression:`(()=>{try{window.startApp();return 'startApp called';}catch(e){return e.stack;}})()`,returnByValue:true});fs.writeFileSync(path.join(output,'start-attempt.json'),JSON.stringify(attempt,null,2));}
  if(loaded&&client){
   const evaluate=async expression=>{const r=await client.call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error('Zoom evaluation failed: '+(r.exceptionDetails.exception?.description||r.exceptionDetails.text));return r.result.value;};
   const hostEval=async expression=>{const r=await homeClient.call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw Error(r.exceptionDetails.exception?.description||r.exceptionDetails.text);return r.result.value;};
   await hostEval(`document.querySelector('[aria-label="Settings"]').click()`);
   const settingsDeadline=Date.now()+5000;while(!await hostEval(`!!document.querySelector('[data-cb-zoom-reset]')&&!document.querySelector('[data-cb-zoom-reset]').disabled`)){if(Date.now()>settingsDeadline)throw Error('Settings zoom did not load');await delay(50);}
   const zoom=()=>hostEval(`Number(document.querySelector('[data-cb-zoom-reset]').textContent.replace('%',''))`);
   if(await evaluate(`document.querySelector('#app-container').getBoundingClientRect().top`)!==0)throw Error('Removed chat toolbar still reserves space');
   console.log('PACKAGED_NO_CHAT_TOOLBAR_PASS');
   const waitZoom=async expected=>{const deadline=Date.now()+5000;while(await zoom()!==expected){if(Date.now()>deadline)throw Error('Zoom did not reach '+expected);await delay(50);}};
   const initial=await zoom();console.log('PACKAGED_ZOOM_INITIAL',initial);
   if(initial!==(process.env.CHATBRIDGE_STARTUP_LABEL==='second-launch'?110:100))throw Error('Saved chat zoom did not restore');
   const hostBefore=await homeClient.call('Runtime.evaluate',{expression:`JSON.stringify({width:document.querySelector('[data-cb-sidebar]').getBoundingClientRect().width,dpr:devicePixelRatio})`,returnByValue:true});
   const hostDpr=JSON.parse(hostBefore.result.value).dpr;
   const waitRendered=async percent=>{const deadline=Date.now()+5000;let dpr;do{dpr=await evaluate('devicePixelRatio');if(Math.abs(dpr/hostDpr-percent/100)<=0.03)return dpr;await delay(100);}while(Date.now()<deadline);throw Error('Rendered zoom did not reach '+percent+': '+dpr);};
   const restoredDpr=await waitRendered(initial);console.log('PACKAGED_RESTORED_ZOOM_DPR',restoredDpr);

   await hostEval(`document.querySelector('[data-cb-zoom-reset]').click()`);await waitZoom(100);const baseDpr=await waitRendered(100);
   await hostEval(`document.querySelector('[data-cb-zoom-in]').click()`);await waitZoom(110);let zoomDpr=await waitRendered(110);const dprDeadline=Date.now()+5000;while(Math.abs(zoomDpr/baseDpr-1.1)>0.03&&Date.now()<dprDeadline){await delay(100);zoomDpr=await evaluate('devicePixelRatio');}console.log('PACKAGED_ZOOM_DPR',JSON.stringify({baseDpr,zoomDpr,percent:await zoom()}));if(Math.abs(zoomDpr/baseDpr-1.1)>0.03)throw Error('Content did not enlarge: '+JSON.stringify({baseDpr,zoomDpr}));
   await hostEval(`document.querySelector('[data-cb-zoom-out]').click()`);await waitZoom(100);await waitRendered(100);
   // CDP key injection bypasses Electron before-input-event; native shortcut wiring is covered in zoom.test.cjs.
   await hostEval(`document.querySelector('[data-cb-zoom-reset]').click()`);await waitZoom(100);await hostEval(`document.querySelector('[data-cb-zoom-in]').click()`);await waitZoom(110);await waitRendered(110);
   const hostAfter=await homeClient.call('Runtime.evaluate',{expression:`JSON.stringify({width:document.querySelector('[data-cb-sidebar]').getBoundingClientRect().width,dpr:devicePixelRatio})`,returnByValue:true});
   if(hostAfter.result.value!==hostBefore.result.value)throw Error('Chat zoom changed the outer workspace');
   console.log('PACKAGED_SETTINGS_ZOOM_PASS: per-account buttons, persisted scale and independent workspace scale');
   await hostEval(`document.querySelector('[data-chatbridge-settings]').lastElementChild.click()`);
   await hostEval(`document.querySelector('[data-cb-account="signal:default"] > button').click()`);
   const shownDeadline=Date.now()+10000;while(await evaluate(`document.visibilityState`)!=='visible'){if(Date.now()>shownDeadline)throw Error('Signal did not become visible after closing settings');await delay(100);}
  }
  if(loaded&&homeClient){
   const evalHost=async expression=>(await homeClient.call('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})).result.value;
   const waitFor=async(check,message)=>{const deadline=Date.now()+90000;while(Date.now()<deadline){const value=await check();if(value)return value;await delay(200);}throw Error(message);};
   await evalHost(`document.querySelector('#cb-home-signal').click()`);
   await waitFor(()=>evalHost(`!!document.querySelector('[data-cb-dialog] input')`),'Signal account form missing');
   await evalHost(`document.querySelector('[data-cb-dialog] input').value='Linux second account';[...document.querySelectorAll('[data-cb-dialog] button')].find(b=>/添加并扫码|Add/.test(b.textContent)).click()`);
   const id=await waitFor(()=>evalHost(`[...document.querySelectorAll('[data-cb-account]')].find(n=>n.textContent.includes('Linux second account'))?.dataset.cbAccount?.split(':')[1]`),'Second Signal account was not added');
   const profile=path.join(process.env.XDG_CONFIG_HOME||path.join(require('node:os').homedir(),'.config'),'ChatBridgeSignalProfiles',id);
   const debug=await waitFor(async()=>{try{return fs.readFileSync(path.join(profile,'DevToolsActivePort'),'utf8').split('\n')[0];}catch{return null;}},'Second Signal debug endpoint missing');
   const page=await waitFor(async()=>{
    const pages=await(await fetch('http://127.0.0.1:'+debug+'/json/list')).json();
    return pages.find(p=>p.type==='page'&&p.url.includes('background.html'));
   },'Second Signal renderer missing');
   const second=await cdp(page.webSocketDebuggerUrl);
   try{
    const read=async()=>{const value=await second.call('Runtime.evaluate',{expression:`({visible:document.visibilityState,text:document.querySelector('#app-container')?.innerText||''})`,returnByValue:true});const result=value.result.value;fs.writeFileSync(path.join(output,'second-state.json'),JSON.stringify(result,null,2));const shot=await second.call('Page.captureScreenshot');fs.writeFileSync(path.join(output,'second-state.png'),Buffer.from(shot.data,'base64'));fs.writeFileSync(path.join(output,'second-events.json'),JSON.stringify(second.events,null,2));return result;};
    await second.call('Runtime.enable');await second.call('Log.enable');
    await waitFor(async()=>{const r=await read();return r?.visible==='visible'&&/link|关联|扫描|device|QR|phone/i.test(r.text);},'Second Signal QR page did not become visible');
    const shot=await second.call('Page.captureScreenshot');fs.writeFileSync(path.join(output,'signal-second-login.png'),Buffer.from(shot.data,'base64'));
    await evalHost(`document.querySelector('[data-cb-account="signal:default"] > button').click()`);
    await waitFor(async()=>{const r=await client.call('Runtime.evaluate',{expression:'document.visibilityState',returnByValue:true});return r.result.value==='visible';},'Default account did not reappear');
    await evalHost(`document.querySelector('[data-cb-account="signal:${id}"] > button').click()`);
    await waitFor(async()=>(await read()).visible==='visible','Second account did not reappear after switching');
    console.log('PACKAGED_SECOND_SIGNAL_QR_AND_SWITCH_PASS');
   }finally{second.close();}
  }
  if(client){const shot=await client.call('Page.captureScreenshot');fs.writeFileSync(path.join(output,'signal-login.png'),Buffer.from(shot.data,'base64'));}
  if(!homeVerified)throw Error('Packaged homepage did not become ready');
  if(!loaded)throw Error('Packaged Signal login did not become visible: '+JSON.stringify(last));
  console.log('PACKAGED_HOMEPAGE_PASS: homepage rendered and account navigation works');
  console.log('PACKAGED_SIGNAL_STARTUP_PASS: real Signal login content visible without chat toolbar');
 }finally{homeClient?.close();if(client){await client.call('Browser.close').catch(()=>{});client.close();}await delay(1000);if(app.exitCode===null)app.kill();outputLog.end();
 const logDir=path.join(process.env.XDG_CONFIG_HOME||path.join(require('node:os').homedir(),'.config'),'ChatBridgeSignal','logs');if(fs.existsSync(logDir))for(const name of fs.readdirSync(logDir).filter(n=>n.endsWith('.log')))fs.copyFileSync(path.join(logDir,name),path.join(output,'signal-'+name));}
})().catch(e=>{console.error(e);process.exitCode=1;});

