// SPDX-License-Identifier: AGPL-3.0-only
'use strict';

function installPreload(options = {}) {
  const ipc = options.ipc || require('electron').ipcRenderer;
  const signalContent = process.argv.includes('--chatbridge-signal-content');
  const wa = options.whatsapp ?? process.argv.includes('--chatbridge-whatsapp');
  if (globalThis.__chatbridgeInstalled) return;
  globalThis.__chatbridgeInstalled = true;
  const call = (method, value) => ipc.invoke('chatbridge:invoke', method, value);
  const make = (tag, text, parent) => {
    const element = document.createElement(tag);
    if (text) element.textContent = text;
    if (parent) parent.append(element);
    return element;
  };
  const invoke = async (method, value, report) => {
    try { return await call(method, value); }
    catch (error) { report.textContent = (error.message || '操作失败').replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, ''); return undefined; }
  };
  const state = { history: false, incoming: false, chat: '', seen: new Set(), baseline: false, serial: Promise.resolve(), jobs: [], draining: false, automatic: 0 };
  let history, incoming, target, status;
  function mount() {
    if (!document.body) return;
    let prefs = { language: 'zh', theme: 'cyan', size: 'normal' };
    const words = {
      zh: { addWA:'＋ 添加 WhatsApp', addSignal:'＋ 添加 Signal', settings:'设置', history:'历史翻译', incoming:'新消息翻译', draft:'输入翻译', ready:'点击消息旁的按钮翻译', title:'工作空间', language:'界面语言', theme:'界面颜色', size:'界面大小', service:'翻译服务', save:'保存设置', close:'关闭', account:'账号备注', add:'添加并扫码', signalInfo:'Signal 账号在右侧固定区域打开，各自独立扫码登录。' },
      en: { addWA:'＋ Add WhatsApp', addSignal:'＋ Add Signal', settings:'Settings', history:'Translate history', incoming:'Translate new messages', draft:'Translate draft', ready:'Translate messages individually', title:'WORKSPACE', language:'Interface language', theme:'Interface color', size:'Interface size', service:'Translation service', save:'Save settings', close:'Close', account:'Account name', add:'Add and link', signalInfo:'Each Signal account opens in the fixed workspace with its own linked-device identity.' }
    };
    let languageNodes = [];
    const label = (tag, key, parent) => { const e=make(tag,words[prefs.language][key],parent); languageNodes.push([e,key]); return e; };
    const css = make('style', null, document.head);
    css.textContent = `
      [data-cb-shell], [data-cb-modal] {--cb-bg:#080e1a;--cb-panel:#101b2d;--cb-text:#e6f4ff;--cb-muted:#8aa1b9;--cb-accent:#42e8df;color:var(--cb-text);font:13px/1.4 "Segoe UI",sans-serif;box-sizing:border-box;color-scheme:dark;}
      [data-cb-shell] *,[data-cb-modal] * {box-sizing:border-box;}
      [data-cb-shell] button,[data-cb-modal] button,[data-cb-shell] select,[data-cb-modal] select,[data-cb-modal] input,[data-cb-modal] textarea {font:inherit;color:var(--cb-text);background:var(--cb-panel);border:1px solid #ffffff20;border-radius:9px;padding:8px 11px;white-space:nowrap;flex-shrink:0;}
      [data-cb-shell] button,[data-cb-modal] button {cursor:pointer;} [data-cb-shell] button:hover,[data-cb-modal] button:hover {border-color:var(--cb-accent);color:var(--cb-accent);}
      [data-cb-shell] button:focus-visible,[data-cb-modal] :focus-visible {outline:2px solid var(--cb-accent);outline-offset:2px;}
      [data-cb-shell] label {display:flex;align-items:center;gap:6px;white-space:nowrap;flex-shrink:0;color:var(--cb-muted);}
      [data-cb-shell] input[type=checkbox] {accent-color:var(--cb-accent);}
      [data-cb-sidebar] button {width:48px;height:48px;padding:11px;border-radius:14px;background:transparent;}
      [data-cb-sidebar] button[data-active=true] {background:#ffffff12;border-color:var(--cb-accent);box-shadow:0 0 18px #42e8df16;}
      [data-cb-sidebar] svg {display:block;width:25px;height:25px;fill:none;stroke:currentColor;stroke-width:1.7;}
      [data-cb-modal] {position:fixed;inset:0;z-index:2147483647;background:#020713b8;display:grid;place-items:center;padding:20px;}
      [data-cb-dialog] {width:430px;max-width:100%;max-height:85vh;overflow:auto;background:var(--cb-bg);border:1px solid #ffffff28;border-radius:18px;box-shadow:0 20px 90px #0009;padding:24px;display:grid;gap:13px;}
      [data-cb-dialog] h2 {font-size:19px;margin:0 0 5px;} [data-cb-dialog] label {display:grid;gap:6px;color:var(--cb-muted);} [data-cb-dialog] textarea {width:100%;resize:vertical;}
    `;
    const shell = make('div',null,document.body); shell.dataset.cbShell='1';
    const bar = make('div',null,shell); bar.dataset.chatbridgeBar='1';
    bar.style.cssText='position:fixed;top:'+((wa||signalContent)?0:32)+'px;left:'+((wa||signalContent)?0:200)+'px;right:0;height:'+((wa||signalContent)?48:76)+'px;z-index:2147483646;background:linear-gradient(110deg,var(--cb-bg),var(--cb-panel));box-shadow:0 1px 18px #42e8df18;border-bottom:1px solid #ffffff15;display:flex;flex-direction:column;justify-content:center;gap:7px;padding:8px 16px;';
    const top = make('div',null,bar); top.style.cssText='display:flex;align-items:center;gap:10px;overflow-x:auto;flex-shrink:0;';
    const controls = make('div',null,bar); controls.style.cssText='display:flex;align-items:center;gap:15px;overflow-x:auto;flex-shrink:0;';
    if (wa||signalContent) { top.remove(); controls.style.height='100%'; }
    const applyPrefs = () => {
      const palettes={cyan:['#080e1a','#101b2d','#e6f4ff','#8aa1b9','#42e8df'],violet:['#100d20','#201a35','#f1eaff','#a79cbe','#b394ff'],light:['#eef3f8','#ffffff','#122337','#54687d','#087f8c']};
      const colors=palettes[prefs.theme]||palettes.cyan;
      for(const host of document.querySelectorAll('[data-cb-shell],[data-cb-modal]')) {
        ['bg','panel','text','muted','accent'].forEach((k,i)=>host.style.setProperty('--cb-'+k,colors[i]));
        host.style.fontSize=({compact:11,normal:13,large:15})[prefs.size]+'px';host.style.colorScheme=prefs.theme==='light'?'light':'dark';
      }
      for(const [e,k] of languageNodes)e.textContent=words[prefs.language][k];
    };
    const modal = title => {
      document.querySelector('[data-cb-modal]')?.remove();
      const overlay=make('div',null,document.body);overlay.dataset.cbModal='1';
      if(!wa&&!signalContent){call('workspace-modal',true).catch(()=>{});const remove=overlay.remove.bind(overlay);overlay.remove=()=>{remove();call('workspace-modal',false).catch(()=>{});};}
      const form=make('div',null,overlay);form.dataset.cbDialog='1';form.setAttribute('role','dialog');form.setAttribute('aria-modal','true');
      make('h2',title,form); overlay.onclick=e=>{if(e.target===overlay)overlay.remove();};
      overlay.onkeydown=e=>{if(e.key==='Escape')overlay.remove();};applyPrefs();return {overlay,form};
    };
    let accounts, load;
    if (!wa && !signalContent) {
      const sidebar=make('div',null,shell);sidebar.dataset.cbSidebar='1';
      sidebar.style.cssText='position:fixed;left:0;top:32px;bottom:0;width:200px;z-index:2147483646;background:var(--cb-bg);border-right:1px solid #ffffff15;display:flex;align-items:stretch;flex-direction:column;gap:10px;padding:18px 10px 14px;';
      const brand=make('button','⌂ 主页',sidebar);brand.title='返回主页 / Home';brand.dataset.cbHomeButton='1';brand.style.cssText='text-align:center;color:var(--cb-accent);letter-spacing:3px;font-size:16px;margin-bottom:12px;';
      const icon=(name,svg)=>{const b=make('button',null,sidebar);b.title=name;b.setAttribute('aria-label',name);b.innerHTML=svg;return b;};
      const signal=icon('Signal','<svg viewBox="0 0 24 24"><circle cx="12" cy="11" r="9" stroke-dasharray="2.5 2"/><path d="M6 18l-2 4 5-2M8 8h8M8 12h6"/></svg>');
      const whatsapp=icon('WhatsApp','<svg viewBox="0 0 24 24"><path d="M20 11a8 8 0 0 1-12 7l-5 2 1-5a8 8 0 1 1 16-4Z"/><path d="M8 7c0 5 3 7 7 7l1-2-3-1-1 1-2-2 1-1-1-2Z"/></svg>');
      signal.style.display='none';whatsapp.style.display='none';
      const accountList=make('div',null,sidebar);accountList.dataset.cbAccountList='1';accountList.style.cssText='display:grid;align-content:start;gap:8px;overflow-y:auto;min-height:0;flex:1;';
      let waList=[],signalList=[],currentSignal='default',selected=null;
      brand.onclick=async()=>{if(await invoke('home',null,status)){selected=null;renderAccounts();}};
      if(ipc.on)ipc.on('chatbridge:home',()=>{selected=null;renderAccounts();});
      const badges=new Map();
      const renderAccounts=()=>{
        accountList.replaceChildren();
        for(const [platform,list,svg] of [['signal',signalList,signal.innerHTML],['whatsapp',waList,whatsapp.innerHTML]]) {
          for(const account of list){
            const row=make('div',null,accountList);row.dataset.cbAccount=platform+':'+account.id;
            row.style.cssText='display:flex;gap:3px;align-items:center;border:1px solid '+(selected===row.dataset.cbAccount?'var(--cb-accent)':'#ffffff18')+';border-radius:12px;background:linear-gradient(120deg,#ffffff0d,transparent);';
            const open=make('button',null,row);open.style.cssText='display:flex;align-items:center;gap:8px;flex:1;min-width:0;width:auto;height:48px;padding:8px;border:0;text-align:left;';
            const symbol=make('span',null,open);symbol.innerHTML=svg;symbol.style.cssText='color:'+(platform==='whatsapp'?'#42e698':'#78a8ff')+';flex-shrink:0;';
            const caption=make('span',account.name,open);caption.style.cssText='overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';open.title=account.name;
            const count=badges.get(account.id)||0;if(count){const badge=make('span',count>99?'99+':String(count),open);badge.style.cssText='border-radius:20px;background:#f05179;color:white;padding:1px 5px;font-size:10px;';}
            open.onclick=async()=>{const ok=await invoke(platform==='whatsapp'?'whatsapp':'open-signal',account.id,status);if(ok){if(platform==='whatsapp'||platform==='signal'){selected=row.dataset.cbAccount;renderAccounts();}else status.textContent=words[prefs.language].signalInfo;}};
            const rename=make('button','⋯',row);rename.title='修改账号备注 / Rename';rename.style.cssText='width:26px;height:34px;padding:0;border:0;';
            rename.onclick=async()=>{await invoke('home',null,status);const {overlay,form}=modal('修改账号备注 / Rename account');const input=make('input',null,form);input.value=account.name;input.maxLength=40;const report=make('span','',form);make('button','保存 / Save',form).onclick=async()=>{if(await invoke('rename-account',{platform,id:account.id,name:input.value},report)){await load();await loadSignals();overlay.remove();}};const remove=make('button','删除账号 / Remove account',form);remove.style.cssText='color:#ff8095;border-color:#ff607950;';
              remove.onclick=()=>{form.replaceChildren();make('h2','确认删除账号？ / Remove account?',form);make('p',account.name,form);make('p','仅从账号列表移除，保留本地登录和聊天数据；不会删除手机上的账号。',form);const report=make('span','',form);const confirm=make('button','确认删除 / Confirm removal',form);confirm.style.color='#ff8095';confirm.onclick=async()=>{confirm.disabled=true;const result=await invoke('remove-account',{platform,id:account.id},report);confirm.disabled=false;if(result){await load();await loadSignals();overlay.remove();status.textContent='账号已从列表移除，本地数据已保留';}};make('button','取消 / Cancel',form).onclick=()=>overlay.remove();};
              make('button','取消 / Cancel',form).onclick=()=>overlay.remove();};
          }
        }
      };
      if(ipc.on)ipc.on('chatbridge:unread',(_e,data)=>{badges.set(data.id,data.count);renderAccounts();});

      const spacer=make('div',null,sidebar);spacer.style.display='none';
      const settings=icon('Settings','<svg viewBox="0 0 24 24"><path d="m9 3-1 3-3 1 1 3-2 2 2 2-1 3 3 1 1 3h6l1-3 3-1-1-3 2-2-2-2 1-3-3-1-1-3Z"/><circle cx="12" cy="12" r="3"/></svg>');
      const title=label('b','title',top);title.style.cssText='font-size:11px;letter-spacing:2px;color:var(--cb-muted);margin-right:5px;';
      const add=label('button','addWA',top);const addSignal=label('button','addSignal',top);
      const updateButton=make('button','↻ 检查更新',top);updateButton.title='检查 ChatBridge 更新（包含 Signal 内核）';
      let updateState={available:false};
      const displayUpdate=s=>{updateState=s;updateButton.textContent=s.available?'⬆ 发现新版':'↻ 检查更新';updateButton.style.cssText=s.available?'color:#42e8df;border-color:#42e8df;box-shadow:0 0 16px #42e8df55;':'';updateButton.disabled=['checking','downloading','installing'].includes(s.status);updateButton.title=s.message||'检查更新';};
      if(ipc.on)ipc.on('chatbridge:update',(_e,s)=>displayUpdate(s));
      call('update-state').then(s=>{if(s)displayUpdate(s);}).catch(()=>{});
      updateButton.onclick=async()=>{
        if(!updateState.available){const s=await invoke('update-check',null,status);if(s){displayUpdate(s);status.textContent=s.message;}return;}
        await invoke('home',null,status);
        const {overlay,form}=modal('更新 ChatBridge');make('p','更新包含新的 Signal 内核及 ChatBridge 功能。请先关闭其他账号窗口，安装时保留原安装位置。账号数据不存放在程序目录。',form);
        const report=make('span','',form);const install=make('button','下载并启动安装',form);install.onclick=async()=>{install.disabled=true;await invoke('update-install',null,report);install.disabled=false;};make('button','稍后',form).onclick=()=>overlay.remove();
      };

      accounts=make('select');accounts.setAttribute('aria-label','WhatsApp accounts');accounts.style.maxWidth='190px';
      load=async()=>{const list=await call('accounts');waList=list;renderAccounts();const previous=accounts.value;accounts.replaceChildren();make('option','WhatsApp',accounts).value='';for(const a of list)make('option',a.name,accounts).value=a.id;accounts.value=previous;};
      const mark=id=>{selected=id?'whatsapp:'+id:null;renderAccounts();};
      signal.onclick=async()=>{if(await invoke('signal',null,status))mark(null);};
      const openWA=async()=>{if(!accounts.value){add.click();return;}if(await invoke('whatsapp',accounts.value,status))mark(accounts.value);};
      whatsapp.onclick=openWA;accounts.onchange=openWA;
      add.onclick=async()=>{
        await invoke('home',null,status);mark(null);
        const {overlay,form}=modal(words[prefs.language].addWA);form.dataset.chatbridgeAddAccount='1';
        const input=make('input',null,form);input.value='WhatsApp '+accounts.options.length;input.maxLength=40;input.placeholder=words[prefs.language].account;
        const report=make('span','',form),save=make('button',words[prefs.language].add,form);
        const submit=async()=>{const name=input.value.trim();if(!name||name.length>40){report.textContent='请填写 1–40 个字符的账号备注';return;}save.disabled=true;const account=await invoke('add-whatsapp',name,report);save.disabled=false;if(account){await load();accounts.value=account.id;mark(account.id);overlay.remove();}};
        save.onclick=submit;input.onkeydown=e=>{if(e.key==='Enter')submit();};make('button',words[prefs.language].close,form).onclick=()=>overlay.remove();input.focus();input.select();
      };
      const signalSelect=make('select');signalSelect.setAttribute('aria-label','Signal accounts');signalSelect.style.maxWidth='170px';
      const loadSignals=async()=>{
        const data=await call('signal-accounts');if(!data?.accounts)return;signalList=data.accounts;currentSignal=data.current;renderAccounts();
        signalSelect.replaceChildren();for(const a of data.accounts)make('option',a.name,signalSelect).value=a.id;
        signalSelect.value=data.current;
        const active=data.accounts.find(a=>a.id===data.current);if(active)signal.title='Signal · '+active.name;
      };
      signalSelect.onchange=async()=>{if(await invoke('open-signal',signalSelect.value,status))status.textContent=words[prefs.language].signalInfo;};
      addSignal.onclick=async()=>{
        await invoke('home',null,status);mark(null);await loadSignals();
        const {overlay,form}=modal(words[prefs.language].addSignal);
        make('p',words[prefs.language].signalInfo,form);
        const input=make('input',null,form);input.maxLength=40;input.value='Signal '+(signalSelect.options.length+1);
        const report=make('span','',form),save=make('button',words[prefs.language].add,form);
        const submit=async()=>{const name=input.value.trim();if(!name||name.length>40){report.textContent='请填写 1–40 个字符的账号备注';return;}save.disabled=true;const a=await invoke('add-signal',name,report);save.disabled=false;if(a){await loadSignals();overlay.remove();status.textContent=words[prefs.language].signalInfo;}};
        save.onclick=submit;input.onkeydown=e=>{if(e.key==='Enter')submit();};
        make('button',words[prefs.language].close,form).onclick=()=>overlay.remove();input.focus();input.select();
      };
      const homeWA=document.querySelector('#cb-home-whatsapp'),homeSignal=document.querySelector('#cb-home-signal');
      if(homeWA)homeWA.onclick=()=>add.click();if(homeSignal)homeSignal.onclick=()=>addSignal.click();
      loadSignals().catch(()=>{});
      if(ipc.on)ipc.on('chatbridge:launch-error',(_e,message)=>{status.textContent=message;});
      if(ipc.on)ipc.on('chatbridge:workspace-status',(_e,s)=>{if(s.error)status.textContent=s.error;});

      settings.onclick=async()=>{
        await invoke('home',null,status);mark(null);
        const {overlay,form}=modal(words[prefs.language].settings);form.dataset.chatbridgeSettings='1';
        const ws=await call('window-settings');
        const titleLabel=make('label','窗口名称 / Window name',form),windowName=make('input',null,titleLabel);windowName.value=ws?.title||'ChatBridge';windowName.maxLength=80;
        const notificationLabel=make('label','WhatsApp 桌面提示 / Desktop alerts',form),notification=make('input',null,notificationLabel);notification.type='checkbox';notification.checked=ws?.notifications!==false;
        const soundLabel=make('label','WhatsApp 提示音 / Sound',form),sound=make('input',null,soundLabel);sound.type='checkbox';sound.checked=ws?.sound!==false;
        make('small','Signal 消息提示使用聊天页内的通知设置。',form);

        const select=(key,choices)=>{const row=make('label',words[prefs.language][key],form);const e=make('select',null,row);for(const [v,t]of choices)make('option',t,e).value=v;e.value=prefs[key];return e;};
        const language=select('language',[['zh','简体中文'],['en','English']]);
        const theme=select('theme',[['cyan','极夜 · 青 / Midnight Cyan'],['violet','星云 · 紫 / Nebula Violet'],['light','冰川 · 白 / Glacier Light']]);
        const size=select('size',[['compact','紧凑 / Compact'],['normal','标准 / Standard'],['large','大字 / Large']]);
        const preview=()=>{prefs={language:language.value,theme:theme.value,size:size.value};applyPrefs();};language.onchange=theme.onchange=size.onchange=preview;
        make('b','本地离线翻译 / Offline translation',form);
        make('small','中英文互译 · 无需密钥 · 无按量收费。模型随安装包提供，首次翻译可能需要几秒加载。',form);
        make('small','公开更新渠道：无需 GitHub 账号或令牌。只检查与下载 ChatBridge 安装包。',form);
        const report=make('span','',form);const save=make('button',words[prefs.language].save,form);
        save.onclick=async()=>{preview();if(!await invoke('window-settings',{title:windowName.value,notifications:notification.checked,sound:sound.checked},report))return;const result=await invoke('preferences',prefs,report);if(result){overlay.remove();}};
        make('button',words[prefs.language].close,form).onclick=()=>{overlay.remove();};
      };
      load().catch(()=>{});
    }
    if(!wa&&!signalContent&&ipc.on)ipc.on('chatbridge:active',(_e,id)=>{controls.style.display=document.querySelector('[data-chatbridge-home]')?'none':id?'none':'flex';});
    const compose=label('button','draft',controls);
    compose.onclick=()=>{
      const {overlay,form}=modal('中文草稿 → English');form.dataset.chatbridgeCompose='1';
      const source=make('textarea',null,form);source.rows=4;source.placeholder='输入中文 / Enter your draft';
      const output=make('textarea',null,form);output.rows=4;output.placeholder='英文译文（可编辑） / Editable translation';
      const report=make('span','',form),translate=make('button','翻译成英文 / Translate',form);
      translate.onclick=async()=>{const text=source.value;translate.disabled=true;const result=await invoke('translate',{text,target:'en'},report);if(result!==undefined&&source.value===text)output.value=result;translate.disabled=false;};
      make('button','复制译文 / Copy',form).onclick=async()=>{if(await invoke('copy',output.value,report))report.textContent='已复制，请核对后粘贴发送 / Copied';};
      make('button',words[prefs.language].close,form).onclick=()=>overlay.remove();
    };
    const hlabel=make('label',null,controls);history=make('input',null,hlabel);history.type='checkbox';label('span','history',hlabel);
    history.onchange=()=>{state.history=history.checked;state.automatic=0;document.querySelectorAll('[data-chatbridge-message]').forEach(b=>delete b.dataset.autoAttempted);scan();};
    const nlabel=make('label',null,controls);incoming=make('input',null,nlabel);incoming.type='checkbox';label('span','incoming',nlabel);
    incoming.onchange=()=>{state.incoming=incoming.checked;state.automatic=0;document.querySelectorAll('[data-chatbridge-message]').forEach(b=>delete b.dataset.autoAttempted);};
    target=make('select',null,controls);make('option','中文',target).value='zh-Hans';make('option','English',target).value='en';
    if(document.querySelector('[data-chatbridge-home]'))controls.style.display='none';
    status=label('span','ready',controls);status.style.cssText='font-size:11px;color:var(--cb-muted);min-width:80px;';status.setAttribute('role','status');
    const layout=make('style',null,document.head);
    layout.textContent=signalContent?'#app-container{position:fixed!important;top:48px!important;left:0!important;right:0!important;bottom:0!important;width:100%!important;height:calc(100% - 48px)!important;}':wa?'#app{height:calc(100vh - 48px)!important;margin-top:48px!important;}':'#app-container{position:fixed!important;top:108px!important;left:200px!important;right:0!important;bottom:0!important;width:calc(100% - 200px)!important;height:calc(100% - 108px)!important;}';
    call('preferences').then(p=>{if(p&&['zh','en'].includes(p.language)){prefs=p;applyPrefs();}}).catch(()=>{});
    if(ipc.on)ipc.on('chatbridge:preferences',(_e,p)=>{prefs=p;applyPrefs();});
    applyPrefs();setInterval(scan,1000);
    if(typeof MutationObserver!=='undefined'){
      let scheduled=false;
      const observer=new MutationObserver(records=>{
        if(scheduled||!records.some(r=>!r.target.parentElement?.closest('[data-chatbridge-message],[data-cb-shell],[data-cb-modal]')&&!r.target.closest?.('[data-chatbridge-message],[data-cb-shell],[data-cb-modal]')))return;
        scheduled=true;setTimeout(()=>{scheduled=false;scan();},40);
      });observer.observe(document.body,{childList:true,subtree:true,characterData:true});
      globalThis.addEventListener?.('pagehide',()=>observer.disconnect(),{once:true});
    }
    scan();
  }
  function messageRows() {
    if (wa) {
      const root = document.querySelector('#main');
      if (!root) return { chat: '', rows: [] };
      const rows = [], seen = new Set();
      for (const bubble of root.querySelectorAll('[data-id]')) {
        const id=bubble.getAttribute('data-id');if(!id||seen.has(id))continue;
        const container=bubble.querySelector('[data-pre-plain-text]')||bubble;
        const selector='.selectable-text,[data-testid="msg-text"]';
        let candidates=[...container.querySelectorAll(selector)];if(container.matches(selector))candidates.unshift(container);
        candidates=candidates.filter(n=>!n.closest('[data-chatbridge-message]')&&!candidates.some(parent=>parent!==n&&parent.contains(n)));
        const text=candidates.map(n=>n.innerText||n.textContent||'').join('\n').trim();
        if(text){seen.add(id);const anchor=candidates[candidates.length-1];rows.push({id,text,node:container===anchor?anchor.parentElement:container,anchor:container===anchor?anchor:null});}
      }
      const match = rows[0]?.id.match(/^(?:true|false)_([^_]+)_/);
      return { chat: match ? match[1] : root.querySelector('header span[title]')?.getAttribute('title') || '', rows };
    }
    const rows = [];
    for (const node of document.querySelectorAll('[data-message-id]')) {
      const textNode = node.querySelector('.module-message__text');
      const text = textNode?.innerText || textNode?.textContent;
      const id = node.getAttribute('data-message-id');
      if (id && text) rows.push({ id, text, node: textNode.parentElement, anchor: textNode });
    }
    const title = document.querySelector('.module-ConversationHeader__header__info__title');
    return { chat: title?.textContent?.trim() || '', rows };
  }
  function translateRow(row, box, manual) {
    if (box.dataset.busy === '1') return;
    const chat = state.chat, language = target.value, original = row.text;
    box.dataset.busy = '1';
    if (!manual) box.dataset.autoAttempted = '1';
    const output = box.querySelector('[data-chatbridge-output]');
    const button = box.querySelector('button'); button.disabled = true;
    output.textContent = '等待翻译';
    state.jobs.push({row,box,manual,chat,language,original,output,button});
    if(state.draining)return;
    state.draining=true;
    state.serial=Promise.resolve().then(async()=>{
      while(state.jobs.length){
        const batch=state.jobs.splice(0,8);
        await Promise.all(batch.map(async job=>{
          const {row,box,manual,chat,language,original,output,button}=job;
          try{
            if((!manual&&!(box.dataset.historical==='1'?state.history:state.incoming))||state.chat!==chat||!box.isConnected||box.dataset.source!==original){output.textContent='';return;}
            output.textContent='翻译中';
            const result=await invoke('translate',{text:original,target:language},output);
            if(result!==undefined&&state.chat===chat&&box.isConnected&&box.dataset.source===original){output.textContent=result;box.dataset.translated='1';button.hidden=true;}
          }finally{box.dataset.busy='0';button.disabled=false;}
        }));
      }
    }).finally(()=>{state.draining=false;});
  }

  function scan() {
    if (!status) return;
    const { chat, rows } = messageRows();
    if (!chat) return;
    const changed = state.chat !== chat;
    if (changed) { state.chat = chat; state.seen.clear(); state.baseline = false; state.automatic = 0; }
    const known = rows.map((r, i) => state.seen.has(r.id) ? i : -1).filter(i => i >= 0);
    const lastKnown = known.length ? Math.max(...known) : Infinity;
    for (const [index, row] of rows.entries()) {
      let box = row.node.querySelector(':scope > [data-chatbridge-message]');
      if (!box) {
        box = make('div', null, row.node); box.dataset.chatbridgeMessage = '1';
        box.style.cssText = 'display:block;max-width:100%;margin:4px 0 0;padding:0;border:0;color:inherit;font:inherit;line-height:1.5;white-space:pre-wrap;overflow-wrap:anywhere;';
        if(row.anchor)row.anchor.after(box);
        box.dataset.historical = !state.baseline || index < lastKnown ? '1' : '0';
        const output = make('div', null, box); output.dataset.chatbridgeOutput = '1';
        make('button', '翻译', box);
      }
      if (changed) { box.dataset.historical = '1'; delete box.dataset.autoAttempted; }
      if (box.dataset.source !== row.text) { box.dataset.source = row.text; box.dataset.translated = '0'; box.querySelector('button').hidden = false; delete box.dataset.autoAttempted; box.querySelector('[data-chatbridge-output]').textContent = ''; }
      box.querySelector('button').onclick = event => { event.preventDefault(); event.stopPropagation(); translateRow(row, box, true); };
      const automatic = box.dataset.historical === '1' ? state.history : state.incoming;
      if (automatic && box.dataset.translated !== '1' && box.dataset.busy !== '1' && box.dataset.autoAttempted !== '1') { state.automatic += 1; translateRow(row, box, false); }
      state.seen.add(row.id);
    }
    if (rows.length) state.baseline = true;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount, { once: true }); else mount();
  return { scan, state, messageRows };
}
module.exports = { installPreload };
if (typeof process !== 'undefined' && process.argv.includes('--chatbridge-whatsapp')) installPreload({ whatsapp: true });
