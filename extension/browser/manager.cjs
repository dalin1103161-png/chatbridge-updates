// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const fs=require('node:fs');
const adapters=require('./adapters.cjs'),{createStore,profile,label}=require('./store.cjs'),environment=require('./profile.cjs');
const proxy=require('../proxy.cjs'),{bindInput}=require('../input.cjs'),{bindContextMenu}=require('../context-menu.cjs'),{bindZoom,zoomState}=require('../zoom.cjs'),{titleUnread,validCount,whatsappUnreadScript}=require('../unread.cjs');
function createBrowserManager({root,rootDir,window,electron,sidebarWidth,hideOtherViews=()=>{},focusHost=()=>{},allowWhatsApp=()=>{},releaseWhatsApp=()=>{},notify=()=>{},notifications=()=>true,lookupProxy}){
 const store=createStore(root,adapters),runtime=new Map(),waContents=new Map();let active=null,disposed=false,queue=Promise.resolve(),restored=false,generation=0;
 const envRuntime=key=>{if(!runtime.has(key))runtime.set(key,{accounts:new Map(),tabs:new Map(),network:null,state:'idle',message:''});return runtime.get(key);};
 const cleanAgent=value=>value.replace(/\b(?:Electron|ChatBridge|Signal)\/[^\s]+\s*/g,'');
 const systemLanguage=electron.app.getPreferredSystemLanguages?.()[0]||electron.app.getLocale?.()||'en-US';
 function snapshot(){return {active,errors:store.errors,engines:{electron:process.versions.electron||'',chromium:process.versions.chrome||''},environments:store.list().map(e=>{const r=runtime.get(e.id);return {id:e.id,name:e.name,archived:e.archived===true,revision:e.revision,profile:e.profile,proxyEnabled:e.proxy.enabled,accounts:e.accounts,tabs:e.tabs.map(t=>({...t,title:r?.tabs.get(t.id)?.title||''})),activeTab:e.activeTab,state:r?.state||'idle',message:r?.message||'',network:r?.network,unread:[...(r?.accounts.values()||[])].reduce((n,a)=>n+(a.unread||0),0)};})};}
 const emit=()=>{if(!disposed)notify(snapshot());};
 function layout(){const [width,height]=window.getContentSize();const left=sidebarWidth();for(const r of runtime.values())for(const {view}of r.tabs.values())if(!view.webContents.isDestroyed())view.setBounds({x:left,y:88,width:Math.max(1,width-left),height:Math.max(1,height-88)});}
 function visibility(){if(window.isDestroyed?.())return;const selected=active?store.get(active).activeTab:null;for(const [key,r]of runtime)for(const [id,t]of r.tabs)t.view.setVisible(key===active&&id===selected&&r.state!=='blocked'&&t.loaded===true);layout();}
 function focus(){if(!active)return;const key=active,tab=store.get(key).activeTab;const wc=runtime.get(key)?.tabs.get(tab)?.view.webContents;if(!wc||wc.isDestroyed())return;Promise.resolve(focusHost()).then(()=>{if(active===key&&store.get(key).activeTab===tab&&!wc.isDestroyed()){window.focus?.();wc.focus?.();}}).catch(()=>{});}
 function hide({remember=false}={}){generation++;if(active===null)return;active=null;if(!remember)store.select(null);visibility();emit();}
 function pause(key,message){const r=envRuntime(key);r.state='blocked';r.message=message;for(const a of r.accounts.values()){a.controller.block();a.session.closeAllConnections().catch(()=>{});}for(const t of r.tabs.values())if(!t.view.webContents.isDestroyed())t.view.webContents.stop?.();visibility();emit();}
 function disposeView(t){const wc=t.view.webContents;if(waContents.has(t.wcId)){waContents.delete(t.wcId);releaseWhatsApp(t.wcId);}if(!window.isDestroyed?.())window.contentView.removeChildView?.(t.view);if(!wc.isDestroyed())wc.close();}
 function disposeRuntime(key){const r=runtime.get(key);if(!r)return;runtime.delete(key);for(const t of r.tabs.values())disposeView(t);for(const a of r.accounts.values()){a.controller.block();if(!a.anchor.webContents.isDestroyed())a.anchor.webContents.close();a.session.closeAllConnections().catch(()=>{});}}
 const protectedPrefs={sandbox:true,contextIsolation:true,nodeIntegration:false,nodeIntegrationInWorker:false,backgroundThrottling:false};
 async function accountRuntime(e,a){
  const r=envRuntime(e.id);if(r.accounts.has(a.id)){const current=r.accounts.get(a.id);await current.ready;return current;}
  const storage=store.sessionPath(e.id,a.id);fs.mkdirSync(storage,{recursive:true});const ses=electron.session.fromPath(storage),anchor=new electron.WebContentsView({webPreferences:{session:ses,...protectedPrefs}});
  const item={session:ses,anchor,unread:undefined};r.accounts.set(a.id,item);
  const geoAllowed=(wc,permission,origin)=>{if(permission!=='geolocation'||!item.effective?.geo||r.state==='blocked'||!wc||!item.geoReady?.has(wc.id))return false;try{return new URL(wc.getURL()).origin===new URL(origin).origin&&new URL(origin).protocol==='https:';}catch{return false;}};
  ses.setPermissionCheckHandler?.(geoAllowed);ses.setPermissionRequestHandler?.((wc,permission,cb,details)=>cb(geoAllowed(wc,permission,details.requestingUrl||wc?.getURL())));ses.setDevicePermissionHandler?.(()=>false);
  item.webContents=new Set();item.geoReady=new Set();item.controller=proxy.createProxyController(anchor.webContents,{net:electron.net,safeStorage:electron.safeStorage,lookup:lookupProxy,notify:s=>{if(s.state==='blocked'&&runtime.get(e.id)===r)pause(e.id,s.message);}});
  item.ready=(async()=>{
   const network=await item.controller.configure(e.proxy);if(disposed||runtime.get(e.id)!==r)throw Error('浏览器环境已关闭。');
   if(r.state==='blocked')throw Error(r.message);
   if(r.network?.ip&&network.ip&&(r.network.ip!==network.ip||r.network.timezone!==network.timezone))throw Error('同一环境中的账号检测到不同出口 IP 或时区，连接已暂停。');
   r.network||=network;item.effective=environment.resolve(e.profile,r.network,systemLanguage);item.network=network;
   item.userAgent=a.adapter==='whatsapp'?cleanAgent(ses.getUserAgent()):ses.getUserAgent();
   const lang=item.effective.language;ses.setUserAgent(item.userAgent,lang.includes('-')?lang+','+lang.split('-')[0]:lang);
  })();
  try{await item.ready;return item;}catch(error){if(runtime.get(e.id)===r)pause(e.id,error.message);throw error;}
 }
 function unreadCount(key,accountId,count){if(!validCount(count))return false;const r=runtime.get(key),record=r?.accounts.get(accountId);if(!record||record.unread===count)return true;const previous=record.unread;record.unread=count;emit();if(previous!==undefined&&count>previous&&notifications()&&electron.Notification?.isSupported()){const e=store.get(key),account=e.accounts.find(a=>a.id===accountId);const toast=new electron.Notification({title:account?.name||'WhatsApp',body:'WhatsApp 有新消息'});toast.on('click',()=>handle({op:'activate',id:key,tab:e.tabs.find(t=>t.accountId===accountId)?.id}).catch(()=>{}));toast.show();}return true;}
 async function openTab(key,tabId){
  const e=store.get(key),r=envRuntime(key),tab=e.tabs.find(t=>t.id===tabId);if(!tab)throw Error('标签页不存在。');if(r.tabs.has(tabId))return r.tabs.get(tabId);
  const a=e.accounts.find(a=>a.id===tab.accountId),adapter=adapters[a.adapter];r.state='checking';r.message='正在初始化网站会话…';emit();const ar=await accountRuntime(e,a);
  if(disposed||runtime.get(key)!==r||r.state==='blocked')throw Error(r.message||'浏览器环境已关闭。');
  const view=new electron.WebContentsView({webPreferences:{session:ar.session,...protectedPrefs,...adapter.preferences(rootDir)}}),wc=view.webContents,t={view,wcId:wc.id,loaded:false,title:'',accountId:a.id};r.tabs.set(tabId,t);ar.webContents.add(wc.id);window.contentView.addChildView(view);view.setVisible(false);layout();
  bindInput(wc,{focus});bindContextMenu(wc,window,electron.Menu);wc.setWindowOpenHandler(details=>{try{const url=adapter.url(details.url);if(details.url!=='about:blank')handle({op:'add-tab',id:key,accountId:a.id,url}).catch(()=>{});}catch{}return {action:'deny'};});
  wc.on('will-navigate',(event,url)=>{try{adapter.url(url);}catch{event.preventDefault();}});
  wc.on('will-redirect',(event,url)=>{try{adapter.url(url);}catch{event.preventDefault();}});
  wc.on('login',(event,_details,info,cb)=>{if(!info.isProxy)return;event.preventDefault();if(e.proxy.enabled&&String(info.host).toLowerCase()===e.proxy.host.replace(/^\[|\]$/g,'').toLowerCase()&&Number(info.port)===e.proxy.port){try{const auth=proxy.credentials(e.proxy,electron.safeStorage);cb(auth.username,auth.password);}catch{cb();}}else cb();});
  const remember=url=>{if(!t.loaded)return;try{const u=adapter.url(url),current=store.get(key).tabs.find(t=>t.id===tabId);if(current&&u!==current.url){store.edit(key,v=>v.tabs.find(t=>t.id===tabId).url=u);emit();}}catch{}};
  wc.on('did-navigate',(_e,url)=>remember(url));wc.on('did-navigate-in-page',(_e,url,isMainFrame)=>{if(isMainFrame)remember(url);});
  wc.on('page-title-updated',(_event,title)=>{t.title=String(title).slice(0,100);if(a.adapter==='whatsapp'&&!ar.authoritative){const count=titleUnread(t.title);if(count!==null)unreadCount(key,a.id,count);}emit();});
  wc.on('render-process-gone',()=>{if(runtime.get(key)===r)pause(key,'网站进程已退出，请刷新重试。');});
  if(a.adapter==='whatsapp'){waContents.set(wc.id,{key,accountId:a.id});allowWhatsApp(wc);}
  t.zoom=bindZoom(wc,value=>{const account=store.get(key).accounts.find(a=>a.id===tab.accountId),state=zoomState(account.zoom,value);if(value!==undefined)store.edit(key,v=>v.accounts.find(a=>a.id===tab.accountId).zoom=state.percent);return state;});
  try{await wc.loadURL('about:blank');await environment.apply(wc,ar.effective,e.proxy.enabled,{languageOverride:e.profile.languageMode!=='system',userAgent:ar.userAgent});ar.geoReady.add(wc.id);wc.debugger.on('detach',()=>{if(runtime.get(key)===r&&r.tabs.get(tabId)===t&&!wc.isDestroyed())pause(key,'环境控制已断开，请刷新重试。');});await wc.loadURL(tab.url);t.loaded=true;remember(wc.getURL());r.state='ready';r.message='';visibility();emit();return t;}
  catch(error){r.tabs.delete(tabId);ar.webContents.delete(t.wcId);ar.geoReady.delete(t.wcId);disposeView(t);if(runtime.get(key)===r)pause(key,'网站加载失败，连接已暂停。请检查代理后刷新。');throw Error('网站加载失败，请检查代理后刷新。',{cause:error});}
 }
 async function activate(key,tab){
  const e=store.get(key);if(e.archived)throw Error('请先恢复此环境。');if(tab!==undefined){if(!e.tabs.some(t=>t.id===tab))throw Error('标签页不存在。');store.edit(key,v=>v.activeTab=tab);}
  hideOtherViews();active=key;store.select(key);visibility();emit();const selected=store.get(key).activeTab;if(selected){const r=envRuntime(key);if(r.state!=='blocked')await openTab(key,selected);visibility();focus();}return snapshot();
 }
 async function diagnose(key){
  const e=store.get(key),r=envRuntime(key);if(!e.activeTab)throw Error('请先添加一个网站再检测。');if(r.state==='blocked')throw Error(r.message||'请先恢复环境连接。');
  await openTab(key,e.activeTab);const checks=[];
  for(const [accountId,a]of r.accounts){let network;try{network=await a.controller.inspect();}catch{network={failed:true};}checks.push({accountId,ip:network.ip||null,failed:network.failed===true||Boolean(e.proxy.enabled&&network.ip!==a.network.ip),timezone:network.timezone||null});}
  const values=[];for(const [tabId,t]of r.tabs){
   if(!t.loaded||t.view.webContents.isDestroyed())continue;const a=r.accounts.get(t.accountId),wc=t.view.webContents,observed=await wc.executeJavaScript(environment.inspectScript);let localeMatches=false,geoMatches=null;
   try{localeMatches=new Intl.Locale(observed.locale).baseName===new Intl.Locale(a.effective.language).baseName;}catch{}
   if(a.effective.geo&&wc.getURL().startsWith('https:')){try{observed.geo=await wc.executeJavaScript(`new Promise(resolve=>{const timer=setTimeout(()=>resolve(null),2500);navigator.geolocation.getCurrentPosition(p=>{clearTimeout(timer);resolve({latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy});},()=>{clearTimeout(timer);resolve(null);},{timeout:1800,maximumAge:0});})`);if(observed.geo)geoMatches=Math.abs(observed.geo.latitude-a.effective.geo.latitude)<.001&&Math.abs(observed.geo.longitude-a.effective.geo.longitude)<.001;}catch{observed.geo=null;}}
   values.push({tabId,configured:a.effective,observed,localeMatches,languageMatches:observed.languages?.[0]?.toLowerCase()===a.effective.language.toLowerCase(),timezoneMatches:!a.effective.timezone||observed.timezone===a.effective.timezone,geoMatches});
  }
  return {checkedAt:new Date().toISOString(),proxyEnabled:e.proxy.enabled,checks,values,consistent:!checks.some(c=>c.failed)&&values.every(v=>v.localeMatches&&v.languageMatches&&v.timezoneMatches&&v.geoMatches!==false)};
 }
 async function command(v){
  if(disposed)throw Error('浏览器管理器已关闭。');const op=v?.op,key=v?.id;
  if(op==='restore'){if(restored)return snapshot();restored=true;const selected=store.selected();return selected?activate(selected):snapshot();}
  if(op==='create'){const e=store.create(v.name);await activate(e.id);return snapshot();}
  if(op==='activate')return activate(key,v.tab);
  if(op==='restore-environment'){
   store.edit(key,e=>{delete e.archived;});return activate(key);
  }
  if(op==='remove-environment'){
   store.get(key);
   const sessions=[...(runtime.get(key)?.accounts.values()||[])].map(a=>a.session);
   if(active===key)hide();
   disposeRuntime(key);
   if(v.permanent===true){
    await Promise.allSettled(sessions.map(async ses=>{
     await ses.closeAllConnections();
     await ses.clearStorageData();
     await ses.clearCache();
    }));
   }
   store.remove(key,v.permanent===true);
   emit();return snapshot();
  }
  if(op==='settings'){const e=store.get(key);let settings;try{settings=proxy.publicConfig(e.proxy,electron.safeStorage);}catch{settings={...e.proxy,secret:undefined,hasPassword:false,username:''};}return {name:e.name,profile:e.profile,proxy:settings};}
  if(op==='check-proxy'){
   const config=proxy.validate(v.proxy,store.get(key).proxy,electron.safeStorage);
   if(!config.enabled)throw Error('请先启用代理并填写代理地址。');
   const session=electron.session.fromPartition('chatbridge-probe-'+require('node:crypto').randomUUID());
   const view=new electron.WebContentsView({webPreferences:{session,...protectedPrefs}});
   const controller=proxy.createProxyController(view.webContents,{net:electron.net,safeStorage:electron.safeStorage,lookup:lookupProxy});
   try{return await controller.configure(config);}
   finally{controller.block();view.webContents.close();await session.closeAllConnections().catch(()=>{});}
  }
  if(op==='save-settings'){
   const e=store.get(key),nextProfile=profile(v.profile),nextProxy=proxy.validate(v.proxy,e.proxy,electron.safeStorage);if(!nextProxy.enabled&&[nextProfile.languageMode,nextProfile.geoMode].includes('ip'))throw Error('语言或位置跟随 IP 时需要启用代理。');
   store.edit(key,x=>{x.name=label(v.name);x.profile=nextProfile;x.proxy=nextProxy;},{settings:true});disposeRuntime(key);if(v.deferActivation)return snapshot();return activate(key);
  }
  if(op==='add-site'){store.addSite(key,v);return activate(key);}
  if(op==='add-tab'){store.addTab(key,v.accountId,v.url);return activate(key);}
  if(op==='duplicate'){store.duplicate(key,v.tab);return activate(key);}
  if(op==='move'){store.move(key,v.tab,v.index);emit();return snapshot();}
  if(op==='close'){store.close(key,v.tab);const r=runtime.get(key),t=r?.tabs.get(v.tab);if(t){r.tabs.delete(v.tab);r.accounts.get(t.accountId)?.webContents.delete(t.wcId);r.accounts.get(t.accountId)?.geoReady.delete(t.wcId);disposeView(t);}return activate(key);}
  if(op==='refresh'){const e=store.get(key);if(!e.activeTab)return snapshot();const r=runtime.get(key);if(r?.state==='blocked'){disposeRuntime(key);return activate(key);}const t=await openTab(key,e.activeTab);await t.view.webContents.loadURL(e.tabs.find(x=>x.id===e.activeTab).url);visibility();return snapshot();}
  if(op==='site-details'){store.edit(key,e=>{const a=e.accounts.find(a=>a.id===v.accountId);if(!a)throw Error('网站账号不存在。');a.platform=label(v.platform);a.name=label(v.name);a.note=label(v.note,500);});emit();return snapshot();}
  if(op==='zoom'){const e=store.get(key),tab=runtime.get(key)?.tabs.get(e.activeTab);if(!tab)throw Error('请先打开标签页。');return tab.zoom(v.action?{action:v.action}:undefined);}
  if(op==='diagnose')return diagnose(key);
  throw Error('未知浏览器环境操作。');
 }
 function handle(v){if(v?.op==='list')return Promise.resolve(snapshot());const token=generation;const job=queue.then(()=>{if(token!==generation)throw Error('已切换工作区。');return command(v);});queue=job.catch(()=>{});return job;}
 const poll=setInterval(()=>{for(const [key,r]of runtime){if(r.state!=='ready')continue;for(const [accountId,a]of r.accounts){if(a.sampling)continue;const t=[...r.tabs.values()].find(t=>t.loaded&&t.accountId===accountId&&waContents.has(t.view.webContents.id));if(!t||t.view.webContents.isDestroyed())continue;a.sampling=true;t.view.webContents.executeJavaScript(whatsappUnreadScript).then(count=>{if(runtime.get(key)===r&&validCount(count)){a.authoritative=true;unreadCount(key,accountId,count);}else a.authoritative=false;}).catch(()=>{a.authoritative=false;}).finally(()=>a.sampling=false);}}},2000);poll.unref?.();
 return {handle,layout,hide,focus,isActive:()=>active!==null,ownsWhatsApp:id=>waContents.has(id),reportUnread(id,count){const o=waContents.get(id);if(!o)return false;const a=runtime.get(o.key)?.accounts.get(o.accountId);return a?.authoritative===true||unreadCount(o.key,o.accountId,count);},preferences(p){for(const r of runtime.values())for(const t of r.tabs.values())if(waContents.has(t.view.webContents.id)&&!t.view.webContents.isDestroyed())t.view.webContents.send('chatbridge:preferences',p);},zoomFor(id,value){for(const r of runtime.values())for(const t of r.tabs.values())if(t.view.webContents.id===id)return t.zoom(value);throw Error('浏览器标签页不存在。');},close(){disposed=true;clearInterval(poll);for(const key of runtime.keys())disposeRuntime(key);}};
}
module.exports={createBrowserManager};
