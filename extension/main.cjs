// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const {zoomState,bindZoom}=require('./zoom.cjs');
const {bindInput,edit}=require('./input.cjs');
const {createUnreadState,titleUnread,validCount,whatsappUnreadScript}=require('./unread.cjs');

function validTranslation(value) {
  if (!value || typeof value.text !== 'string' || !value.text.trim() || value.text.length > 10000 || !['en', 'zh-Hans'].includes(value.target)) {
    throw new Error('每次需要 1–10000 个字符，目标语言为中文或英文。');
  }
  return value;
}

function installChatBridge(window, rootDir, suppliedElectron) {
  if (suppliedElectron) return installWorkspace(window, rootDir, suppliedElectron);
  const electron = require('electron');
  if (process.platform !== 'win32') throw new Error('ChatBridge managed workspace requires Windows.');
  const host = require('./host.cjs');
  if (process.env.CHATBRIDGE_HOST_PIPE) return host.installManagedSignal(window, electron);
  const native = host.createNativeWorkspace(window, rootDir, electron);
  return installWorkspace(native.host, rootDir, electron, native);
}
function installWorkspace(window, rootDir, suppliedElectron, native) {
  const { app, ipcMain, WebContentsView, clipboard, Notification, Menu } = suppliedElectron || require('electron');
  const spawn = suppliedElectron?.spawn || require('node:child_process').spawn;
  let updater;
  if (!suppliedElectron || native) { updater=require('./updater.cjs').createUpdater({app,spawn,rootDir,notify:s=>window.webContents.send('chatbridge:update',s)}); }
  const registryDir = path.join(app.getPath('appData'), 'ChatBridgeSignalAccounts');
  fs.mkdirSync(registryDir, { recursive: true });
  const currentProfile = process.env.CHATBRIDGE_SIGNAL_PROFILE || 'default';
  const signalAccounts = () => {
    const defaultFile = path.join(registryDir, 'default.json');
    const result = [{ id: 'default', name: fs.existsSync(defaultFile) ? JSON.parse(fs.readFileSync(defaultFile, 'utf8')).name : 'Signal 1' }];
    for (const name of fs.readdirSync(registryDir)) {
      if (!/^[a-f0-9-]{36}\.json$/.test(name)) continue;
      const account = JSON.parse(fs.readFileSync(path.join(registryDir, name), 'utf8'));
      if (account.id + '.json' === name && typeof account.name === 'string') result.push(account);
    }
    return result.filter(a => !fs.existsSync(path.join(registryDir, a.id + '.removed')));
  };
  const launchSignal = async id => {
    if(native){for(const view of views.values())view.setVisible(false);activeId=null;await native.open(id);window.webContents.send('chatbridge:signal-active',id);return;}
    if (id === currentProfile) { show(null); return; }
    const account = signalAccounts().find(a => a.id === id);
    if (!account) throw new Error('未知 Signal 账号。');
    const env = { ...process.env, CHATBRIDGE_SIGNAL_PROFILE: id };
    delete env.ELECTRON_RUN_AS_NODE;
    const args = app.isPackaged ? [] : [rootDir];
    const child = spawn(app.getPath('exe'), args, { env, detached: true, stdio: 'ignore', windowsHide: false });
    child.on('error', () => window.webContents.send('chatbridge:launch-error', 'Signal 账号窗口启动失败，请重试。'));
    child.unref();
  };
  const views = new Map();
  const allowed = new Set([window.webContents.id]);
  if(native)allowed.add(native.defaultWebContents.id);
  let activeId = null;
  const focusWhatsApp=async id=>{const view=views.get(id);if(!view)return;window.webContents.focus?.();if(native&&!(await native.focusHost()))return;if(activeId!==id||view.webContents.isDestroyed())return;window.focus?.();view.webContents.focus?.();};
  window.on('chatbridge:chat-hidden',()=>{if(activeId!==null)focusWhatsApp(activeId);});
  const translator = suppliedElectron?.localTranslator || require('./local-translator.cjs').createTranslator();
  const warmupTimer=setTimeout(()=>{if(translator.warmup)translator.warmup().catch(()=>{});},1500);warmupTimer.unref();
  let config = { accounts: [], preferences: { language: 'zh', theme: 'cyan', size: 'normal' } };
  const filename = path.join(app.getPath('userData'), 'chatbridge-whatsapp.json');
  if (fs.existsSync(filename)) {
    config = JSON.parse(fs.readFileSync(filename, 'utf8'));
    if (!Array.isArray(config.accounts) || config.accounts.some(a => !/^[a-f0-9-]{36}$/.test(a.id) || typeof a.name !== 'string')) {
      throw new Error('WhatsApp 账号配置格式错误。');
    }
  }
  let sidebarWidth=Number.isInteger(config.sidebarWidth)&&config.sidebarWidth>=88&&config.sidebarWidth<=320?config.sidebarWidth:144;
  native?.setSidebarWidth(sidebarWidth);
  const save = () => {
    const temp = filename + '.' + crypto.randomUUID() + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(config), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temp, filename);
  };
  const zoomBindings=new Map();
  const savedZoom=config.chatZoom&&typeof config.chatZoom==='object'&&!Array.isArray(config.chatZoom)?config.chatZoom:{};
  const accountZoom=(platform,id,value)=>{
    const key=platform+':'+id,state=zoomState(savedZoom[key],value);
    if(value!==undefined&&savedZoom[key]!==state.percent){savedZoom[key]=state.percent;config.chatZoom=savedZoom;save();}
    return state;
  };
  const attachZoom=(contents,platform,id)=>zoomBindings.set(contents.id,bindZoom(contents,value=>accountZoom(platform,id,value),{keepScale:platform==='signal'}));
  bindInput(window.webContents);
  if(native)bindInput(native.defaultWebContents,undefined,{nativeEditing:true});
  attachZoom(native?.defaultWebContents||window.webContents,'signal',currentProfile);
  const updateTitle = () => window.setTitle?.(config.windowTitle || 'ChatBridge');
  updateTitle();
  window.webContents.on?.('page-title-updated', event => { if (config.windowTitle) { event.preventDefault(); updateTitle(); } });
  const waUnreadReaders=new Map();
  const unread=createUnreadState(entry=>window.webContents.send('chatbridge:unread',entry));
  const reportSignalUnread=(id,count)=>{if(signalAccounts().some(a=>a.id===id))unread.update('signal',id,count);};
  window.on('chatbridge:signal-unread',reportSignalUnread);
  const bounds = () => {
    const [width, height] = window.getContentSize();
    for (const view of views.values()) view.setBounds({ x: sidebarWidth, y: 48, width: Math.max(1, width - sidebarWidth), height: Math.max(1, height - 48) });
  };
  function show(id) {
    activeId = id;
    if(native){if(id===null)native.open(currentProfile).catch(()=>{});else native.hide();}
    for (const [mid, view] of views) view.setVisible(mid === id);
    window.webContents.send('chatbridge:active', id);
    bounds();
    if(id!==null)focusWhatsApp(id);
  }
  const updateWhatsAppUnread=(account,count,notify=true)=>{
    if(!config.accounts.some(a=>a.id===account.id))return;
    const previous=unread.snapshot().find(e=>e.platform==='whatsapp'&&e.id===account.id)?.count;
    const changed=unread.update('whatsapp',account.id,count);
    if(changed&&notify&&previous!==undefined&&count>previous&&config.notifications!==false&&Notification?.isSupported()){
      const toast=new Notification({title:account.name,body:'WhatsApp 有新消息',silent:config.sound===false});toast.on('click',()=>{window.show?.();window.focus?.();openWhatsApp(account);});toast.show();
    }
  };
  function ensureWhatsApp(account) {
    if (!views.has(account.id)) {
      const view = new WebContentsView({ webPreferences: {
        partition: 'persist:chatbridge-wa-' + account.id,
        preload: path.join(rootDir, 'chatbridge', 'preload.cjs'),
        additionalArguments: ['--chatbridge-whatsapp'],
        sandbox: true, contextIsolation: true, nodeIntegration: false,backgroundThrottling:false,
      } });
      views.set(account.id, view);
      allowed.add(view.webContents.id);
      bindInput(view.webContents,{focus:()=>{focusWhatsApp(account.id).catch(()=>{});}});
      attachZoom(view.webContents,'whatsapp',account.id);
      require('./context-menu.cjs').bindContextMenu(view.webContents,window,Menu);
      window.contentView.addChildView(view);
      view.setVisible(false);
      const ua = view.webContents.getUserAgent().replace(/\b(?:Electron|ChatBridge|Signal)\/[^\s]+\s*/g, '');
      view.webContents.setUserAgent(ua);
      view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      view.webContents.on('will-navigate', (event, url) => {
        try { const parsed = new URL(url); if (parsed.protocol !== 'https:' || parsed.hostname !== 'web.whatsapp.com') event.preventDefault(); }
        catch { event.preventDefault(); }
      });
      let authoritative=false,busy=false,misses=0,lastFallback=null,stopped=false;
      const sample=async()=>{
        if(stopped||busy||view.webContents.isDestroyed()||typeof view.webContents.executeJavaScript!=='function')return;busy=true;
        try{const count=await view.webContents.executeJavaScript(whatsappUnreadScript);
          if(stopped)return;if(validCount(count)){const wasAuthoritative=authoritative;authoritative=true;misses=0;updateWhatsAppUnread(account,count,wasAuthoritative);}
          else if(++misses>=3){authoritative=false;if(lastFallback!==null)updateWhatsAppUnread(account,lastFallback);}
        }catch{if(++misses>=3)authoritative=false;}finally{busy=false;}
      };
      const reader={reportTitle(count){lastFallback=count;if(authoritative){sample();return;}updateWhatsAppUnread(account,count);},stop(){stopped=true;clearInterval(timer);}};
      const timer=setInterval(sample,1000);timer.unref?.();waUnreadReaders.set(account.id,reader);
      view.webContents.once('destroyed',()=>{reader.stop();waUnreadReaders.delete(account.id);});
      view.webContents.on('page-title-updated',(_event,title)=>{const count=titleUnread(title);if(count!==null)reader.reportTitle(count);});
      view.webContents.on('did-finish-load',()=>{authoritative=false;misses=0;sample();if(activeId===account.id)focusWhatsApp(account.id);});
      view.webContents.loadURL('https://web.whatsapp.com/');
    }
  }
  function openWhatsApp(account){ensureWhatsApp(account);show(account.id);}
  const authorized = event => {
    if (!allowed.has(event.sender.id)) throw new Error('此页面没有调用翻译接口的权限。');
  };
  const handleRequest = async (event, method, value) => {
    authorized(event);
    if(method==='edit')return edit(event.sender,value);
    if(method==='unread-state'){if(event.sender.id!==window.webContents.id)throw Error('仅工作空间可读取未读状态。');return unread.snapshot();}
    if(method==='unread-report'){const account=config.accounts.find(a=>views.get(a.id)?.webContents.id===event.sender.id);if(!account||!validCount(value))throw Error('未读状态无效。');waUnreadReaders.get(account.id)?.reportTitle(value);return true;}
    if(method==='input-diagnostics')return native?native.inputDiagnostics():{available:false};
    if(method==='chat-zoom'){const apply=zoomBindings.get(event.sender.id);if(!apply)throw new Error('请在聊天区域调整缩放。');return apply(value);}
    if (method === 'translate') {
      validTranslation(value);
      return translator.translate(value.text, value.target);
    }
    if (method === 'copy') {
      if (typeof value !== 'string' || value.length > 10000) throw new Error('复制内容无效。');
      await clipboard.writeText(value); return true;
    }
    if (method === 'preferences') {
      const fallback = { language: 'zh', theme: 'cyan', size: 'normal' };
      if (value === undefined) return config.preferences || fallback;
      if (event.sender.id !== window.webContents.id) throw new Error('请从 APP 设置调整界面。');
      if (!value || !['zh','en'].includes(value.language) || !['cyan','violet','light'].includes(value.theme) || !['compact','normal','large'].includes(value.size)) throw new Error('界面设置无效。');
      if(value.translationTarget!==undefined&&!['zh-Hans','en'].includes(value.translationTarget))throw Error('翻译语言无效。');
      config.preferences = { language: value.language, theme: value.theme, size: value.size, ...(value.translationTarget?{translationTarget:value.translationTarget}:{}) }; save();
      for (const view of views.values()) view.webContents.send('chatbridge:preferences', config.preferences);
      native?.preferences(config.preferences);return config.preferences;
    }
    if (method === 'accounts') return config.accounts;
    // Workspace changes can only come from the trusted Signal application frame.
    if (event.sender.id !== window.webContents.id) throw new Error('请从 APP 顶部切换账号。');
    if(method==='workspace-zoom'){
      if(!value||!['signal','whatsapp'].includes(value.platform)||typeof value.id!=='string'||!(value.platform==='signal'?signalAccounts():config.accounts).some(a=>a.id===value.id))throw Error('请选择有效账号。');
      const state=accountZoom(value.platform,value.id,value.action===undefined?undefined:{action:value.action});
      if(value.action!==undefined){
        if(value.platform==='whatsapp'){const view=views.get(value.id);if(view)await zoomBindings.get(view.webContents.id)?.();}
        else if(value.id===currentProfile)await zoomBindings.get(native?.defaultWebContents.id||window.webContents.id)?.();
        else native?.refreshZoom(value.id);
      }
      return state;
    }
    if(method==='account-order'){
      const keys=[...signalAccounts().map(a=>'signal:'+a.id),...config.accounts.map(a=>'whatsapp:'+a.id)];
      const current=[...new Set([...(Array.isArray(config.accountOrder)?config.accountOrder:[]).filter(key=>keys.includes(key)),...keys])];
      if(value===undefined)return current;
      if(!Array.isArray(value)||value.length!==keys.length||new Set(value).size!==keys.length||value.some(key=>!keys.includes(key)))throw Error('账号排序无效，请刷新账号列表后重试。');
      config.accountOrder=value.slice();save();return config.accountOrder;
    }
    if(method==='sidebar-width'){
      if(value===undefined)return {width:sidebarWidth};
      if(!value||!Number.isInteger(value.width)||value.width<88||value.width>320||typeof value.persist!=='boolean')throw new Error('侧栏宽度无效。');
      sidebarWidth=value.width;native?.setSidebarWidth(sidebarWidth);bounds();
      if(value.persist){config.sidebarWidth=sidebarWidth;save();}
      return {width:sidebarWidth};
    }
    if(method==='home'){activeId=null;for(const view of views.values())view.setVisible(false);native?.hide();window.webContents.send('chatbridge:home');return true;}
    if(method==='workspace-modal'){if(native)native.suspend(value===true);return true;}
    if (method.startsWith('update-')) {
      if (!updater) throw new Error('更新模块未初始化。');
      if (method === 'update-state') return updater.state();
      if (method === 'update-check') return updater.check();
      if (method === 'update-install') return updater.install();
      throw new Error('未知更新操作。');
    }
    if (method === 'window-settings') {
      if (value === undefined) return { title: config.windowTitle || 'ChatBridge', notifications: config.notifications !== false, sound: config.sound !== false };
      if (!value || typeof value.title !== 'string' || !value.title.trim() || value.title.trim().length > 80 || typeof value.notifications !== 'boolean' || typeof value.sound !== 'boolean') throw new Error('窗口设置无效。');
      config.windowTitle = value.title.trim(); config.notifications = value.notifications; config.sound = value.sound; save(); updateTitle(); return true;
    }
    if (method === 'remove-account') {
      if (!value || !['whatsapp','signal'].includes(value.platform) || typeof value.id !== 'string') throw new Error('账号参数无效。');
      if (value.platform === 'whatsapp') {
        const index = config.accounts.findIndex(a => a.id === value.id); if (index < 0) throw new Error('未知账号。');
        config.accounts.splice(index, 1); save();
        const view = views.get(value.id);
        if (view) { allowed.delete(view.webContents.id); zoomBindings.delete(view.webContents.id); window.contentView.removeChildView?.(view); if (!view.webContents.isDestroyed()) view.webContents.close(); views.delete(value.id); }
        waUnreadReaders.get(value.id)?.stop();waUnreadReaders.delete(value.id);unread.remove('whatsapp',value.id); if (activeId === value.id) show(null);
      } else {
        const account = signalAccounts().find(a => a.id === value.id); if (!account) throw new Error('未知账号。');
        fs.writeFileSync(path.join(registryDir, account.id + '.removed'), '', { mode: 0o600 });
        unread.remove('signal',account.id);if(native)native.close(account.id);
      }
      activeId=null;for(const view of views.values())view.setVisible(false);native?.hide();window.webContents.send('chatbridge:home');
      return { removed: true, retainedLocalData: true };
    }
    if (method === 'rename-account') {
      if (!value || typeof value.name !== 'string' || !value.name.trim() || value.name.trim().length > 40) throw new Error('备注需要 1–40 个字符。');
      if (value.platform === 'whatsapp') {
        const account = config.accounts.find(a => a.id === value.id); if (!account) throw new Error('未知账号。');
        account.name = value.name.trim(); save(); return true;
      }
      if (value.platform === 'signal') {
        const account = signalAccounts().find(a => a.id === value.id); if (!account) throw new Error('未知账号。');
        const temp = path.join(registryDir, account.id + '.' + crypto.randomUUID() + '.tmp');
        fs.writeFileSync(temp, JSON.stringify({id: account.id, name: value.name.trim()}), {mode:0o600});
        fs.renameSync(temp, path.join(registryDir, account.id + '.json')); return true;
      }
      throw new Error('未知平台。');
    }
    if (method === 'signal-accounts') return { accounts: signalAccounts(), current: currentProfile };
    if (method === 'open-signal') { if(!signalAccounts().some(a=>a.id===value))throw new Error('未知 Signal 账号。');await launchSignal(value); return true; }
    if (method === 'add-signal') {
      if (typeof value !== 'string' || !value.trim() || value.trim().length > 40) throw new Error('备注需要 1–40 个字符。');
      const account = { id: crypto.randomUUID(), name: value.trim() };
      fs.writeFileSync(path.join(registryDir, account.id + '.json'), JSON.stringify(account), { flag: 'wx', mode: 0o600 });
      await launchSignal(account.id); return account;
    }
    if (method === 'signal') { show(null); return true; }
    if (method === 'whatsapp') {
      const account = config.accounts.find(a => a.id === value);
      if (!account) throw new Error('未知账号。');
      openWhatsApp(account); return true;
    }
    if (method === 'add-whatsapp') {
      if (typeof value !== 'string' || !value.trim() || value.trim().length > 40) throw new Error('备注需要 1–40 个字符。');
      const account = { id: crypto.randomUUID(), name: value.trim() };
      config.accounts.push(account); save(); openWhatsApp(account); return account;
    }
    throw new Error('未知请求。');
  };
  ipcMain.handle('chatbridge:invoke',handleRequest);
  if(native)native.setRPC((method,value,profile)=>{if(method==='chat-zoom'){if(!signalAccounts().some(a=>a.id===profile))throw Error('未知 Signal 账号。');return accountZoom('signal',profile,value);}return handleRequest({sender:{id:window.webContents.id}},method,value);});
  for(const account of config.accounts)ensureWhatsApp(account);
  if(native)for(const account of signalAccounts())if(account.id!=='default')native.start(account.id).catch(()=>window.webContents.send('chatbridge:launch-error','Signal 后台账号启动失败，请点击账号重试。'));
  window.on('resize', bounds);
  let updateTimer;
  if (updater) { updater.check(); updateTimer=setInterval(()=>updater.check(),6*60*60*1000);updateTimer.unref(); }
  window.once('closed', () => {
    if(updateTimer)clearInterval(updateTimer);
    ipcMain.removeHandler('chatbridge:invoke');
    for (const view of views.values()) if (!view.webContents.isDestroyed()) view.webContents.close();
    for(const reader of waUnreadReaders.values())reader.stop();waUnreadReaders.clear();
    clearTimeout(warmupTimer);allowed.clear(); views.clear(); zoomBindings.clear(); translator.close();
  });
  return { show, views };
}
module.exports = { installChatBridge, validTranslation };

