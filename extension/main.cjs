// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function validTranslation(value) {
  if (!value || typeof value.text !== 'string' || !value.text.trim() || value.text.length > 10000 || !['en', 'zh-Hans'].includes(value.target)) {
    throw new Error('每次需要 1–10000 个字符，目标语言为中文或英文。');
  }
  return value;
}

function installChatBridge(window, rootDir, suppliedElectron) {
  const { app, ipcMain, WebContentsView, clipboard, Notification } = suppliedElectron || require('electron');
  const spawn = suppliedElectron?.spawn || require('node:child_process').spawn;
  let updater;
  if (!suppliedElectron) { updater=require('./updater.cjs').createUpdater({app,spawn,rootDir,notify:s=>window.webContents.send('chatbridge:update',s)}); }
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
  const launchSignal = id => {
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
  let key = '', region = '', activeId = null;
  let config = { accounts: [], preferences: { language: 'zh', theme: 'cyan', size: 'normal' } };
  const filename = path.join(app.getPath('userData'), 'chatbridge-whatsapp.json');
  if (fs.existsSync(filename)) {
    config = JSON.parse(fs.readFileSync(filename, 'utf8'));
    if (!Array.isArray(config.accounts) || config.accounts.some(a => !/^[a-f0-9-]{36}$/.test(a.id) || typeof a.name !== 'string')) {
      throw new Error('WhatsApp 账号配置格式错误。');
    }
  }
  const save = () => {
    const temp = filename + '.' + crypto.randomUUID() + '.tmp';
    fs.writeFileSync(temp, JSON.stringify(config), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temp, filename);
  };
  const updateTitle = () => window.setTitle?.(config.windowTitle || 'ChatBridge');
  updateTitle();
  window.webContents.on?.('page-title-updated', event => { if (config.windowTitle) { event.preventDefault(); updateTitle(); } });
  const unread = new Map();
  const bounds = () => {
    const [width, height] = window.getContentSize();
    for (const view of views.values()) view.setBounds({ x: 200, y: 108, width: Math.max(1, width - 200), height: Math.max(1, height - 108) });
  };
  function show(id) {
    activeId = id;
    for (const [mid, view] of views) view.setVisible(mid === id);
    window.webContents.send('chatbridge:active', id);
    bounds();
  }
  function openWhatsApp(account) {
    if (!views.has(account.id)) {
      const view = new WebContentsView({ webPreferences: {
        partition: 'persist:chatbridge-wa-' + account.id,
        preload: path.join(rootDir, 'chatbridge', 'preload.cjs'),
        additionalArguments: ['--chatbridge-whatsapp'],
        sandbox: true, contextIsolation: true, nodeIntegration: false,
      } });
      views.set(account.id, view);
      allowed.add(view.webContents.id);
      window.contentView.addChildView(view);
      view.setVisible(false);
      const ua = view.webContents.getUserAgent().replace(/\b(?:Electron|ChatBridge|Signal)\/[^\s]+\s*/g, '');
      view.webContents.setUserAgent(ua);
      view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      view.webContents.on('will-navigate', (event, url) => {
        try { const parsed = new URL(url); if (parsed.protocol !== 'https:' || parsed.hostname !== 'web.whatsapp.com') event.preventDefault(); }
        catch { event.preventDefault(); }
      });
      view.webContents.on('page-title-updated', (_event, title) => {
        const count = Math.min(9999, Number(/^\((\d+)\)/.exec(title)?.[1] || 0));
        const previous = unread.get(account.id); unread.set(account.id, count);
        window.webContents.send('chatbridge:unread', { id: account.id, count });
        if (previous !== undefined && count > previous && config.notifications !== false && Notification?.isSupported()) {
          const toast = new Notification({ title: account.name, body: 'WhatsApp 有新消息', silent: config.sound === false });
          toast.on('click', () => { window.show?.(); window.focus?.(); openWhatsApp(account); }); toast.show();
        }
      });
      view.webContents.loadURL('https://web.whatsapp.com/');
    }
    show(account.id);
  }
  const authorized = event => {
    if (!allowed.has(event.sender.id)) throw new Error('此页面没有调用翻译接口的权限。');
  };
  ipcMain.handle('chatbridge:invoke', async (event, method, value) => {
    authorized(event);
    if (method === 'settings') {
      if (event.sender.id !== window.webContents.id) throw new Error('请在 Signal 页配置翻译服务。');
      if (!value || typeof value.key !== 'string' || typeof value.region !== 'string') throw new Error('设置无效。');
      key = value.key.trim(); region = value.region.trim();
      return { configured: Boolean(key) };
    }
    if (method === 'translate') {
      validTranslation(value);
      if (!key) throw new Error('请先在 Signal 页顶部“翻译设置”配置服务。');
      const headers = { 'Content-Type': 'application/json', 'Ocp-Apim-Subscription-Key': key };
      if (region) headers['Ocp-Apim-Subscription-Region'] = region;
      const response = await fetch('https://api.cognitive.microsofttranslator.com/translate?api-version=3.0&to=' + value.target, {
        method: 'POST', headers, body: JSON.stringify([{ Text: value.text }]), signal: AbortSignal.timeout(25000),
        redirect: 'error',
      });
      if (!response.ok) throw new Error('翻译服务 HTTP ' + response.status + '，请检查密钥、区域及额度。');
      const payload = await response.json();
      const text = payload?.[0]?.translations?.[0]?.text;
      if (typeof text !== 'string') throw new Error('翻译响应异常。');
      return text;
    }
    if (method === 'copy') {
      if (typeof value !== 'string' || value.length > 10000) throw new Error('复制内容无效。');
      clipboard.writeText(value); return true;
    }
    if (method === 'preferences') {
      const fallback = { language: 'zh', theme: 'cyan', size: 'normal' };
      if (value === undefined) return config.preferences || fallback;
      if (event.sender.id !== window.webContents.id) throw new Error('请从 APP 设置调整界面。');
      if (!value || !['zh','en'].includes(value.language) || !['cyan','violet','light'].includes(value.theme) || !['compact','normal','large'].includes(value.size)) throw new Error('界面设置无效。');
      config.preferences = { language: value.language, theme: value.theme, size: value.size }; save();
      for (const view of views.values()) view.webContents.send('chatbridge:preferences', config.preferences);
      return config.preferences;
    }
    if (method === 'accounts') return config.accounts;
    // Workspace changes can only come from the trusted Signal application frame.
    if (event.sender.id !== window.webContents.id) throw new Error('请从 APP 顶部切换账号。');
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
        if (view) { allowed.delete(view.webContents.id); window.contentView.removeChildView?.(view); if (!view.webContents.isDestroyed()) view.webContents.close(); views.delete(value.id); }
        unread.delete(value.id); if (activeId === value.id) show(null);
      } else {
        const account = signalAccounts().find(a => a.id === value.id); if (!account) throw new Error('未知账号。');
        fs.writeFileSync(path.join(registryDir, account.id + '.removed'), '', { mode: 0o600 });
      }
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
    if (method === 'open-signal') { launchSignal(value); return true; }
    if (method === 'add-signal') {
      if (typeof value !== 'string' || !value.trim() || value.trim().length > 40) throw new Error('备注需要 1–40 个字符。');
      const account = { id: crypto.randomUUID(), name: value.trim() };
      fs.writeFileSync(path.join(registryDir, account.id + '.json'), JSON.stringify(account), { flag: 'wx', mode: 0o600 });
      launchSignal(account.id); return account;
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
  });
  window.on('resize', bounds);
  let updateTimer;
  if (updater) { updater.check(); updateTimer=setInterval(()=>updater.check(),6*60*60*1000);updateTimer.unref(); }
  window.once('closed', () => {
    if(updateTimer)clearInterval(updateTimer);
    ipcMain.removeHandler('chatbridge:invoke');
    for (const view of views.values()) if (!view.webContents.isDestroyed()) view.webContents.close();
    allowed.clear(); views.clear(); key = ''; region = '';
  });
  return { show, views };
}
module.exports = { installChatBridge, validTranslation };
