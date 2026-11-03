// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {parseProxyLine}=require('../preload.cjs');
function installBrowserUI(ipc=require('electron').ipcRenderer){
 const call=(op,args={})=>ipc.invoke('chatbridge:invoke','browser-env',{op,...args});
 const create=(tag,text,parent)=>{const n=document.createElement(tag);if(text)n.textContent=text;parent?.append(n);return n;};
 function mount(){
  const workspace=document.querySelector('[data-cb-workspace-actions]'),sidebar=document.querySelector('[data-cb-sidebar]');if(!workspace||!sidebar)return;
  const shell=document.querySelector('[data-cb-shell]'),list=document.querySelector('[data-cb-account-list]');if(!shell||!list)return;
  const css=create('style',null,document.head);css.textContent=`
  [data-browser-list]{display:grid;gap:5px;max-height:28vh;overflow:auto;min-height:0;flex-shrink:0}[data-browser-list] button{width:100%;height:auto;padding:7px 8px;text-align:left;overflow:hidden;text-overflow:ellipsis;border-radius:8px}
  [data-browser-list] button[data-active=true]{border-color:var(--cb-accent);color:var(--cb-accent)}[data-browser-tabbar]{position:fixed;left:var(--cb-sidebar-width,144px);right:0;top:48px;height:40px;padding:3px 7px;display:flex;gap:4px;align-items:center;z-index:2147483645;background:var(--cb-bg);border-bottom:1px solid #ffffff18}
  body[data-browser-active] main[data-chatbridge-home]{visibility:hidden}[data-browser-tabbar][hidden],[data-browser-list][hidden]{display:none!important}[data-browser-tabbar] button{padding:5px 8px;max-width:180px;overflow:hidden;text-overflow:ellipsis}
  [data-browser-tabs]{min-width:0;display:flex;gap:4px;overflow:auto;flex:1;align-items:center;height:100%}[data-browser-tab]{display:flex;flex-shrink:0;border:1px solid #ffffff15;border-radius:7px}[data-browser-tab][data-active=true]{border-color:var(--cb-accent)}[data-browser-tab] button{border:0;background:transparent}
  [data-browser-report]{white-space:pre-wrap;overflow-wrap:anywhere;color:var(--cb-muted)}[data-browser-dialog] select,[data-browser-dialog] input,[data-browser-dialog] textarea{min-width:0;width:100%}[data-browser-dialog] input[type=checkbox]{width:auto;justify-self:start}
  `;
  const envList=create('div',null);envList.dataset.browserList='1';envList.hidden=true;sidebar.insertBefore(envList,list);
  const bar=create('div',null,shell);bar.dataset.browserTabbar='1';bar.hidden=true;const tabs=create('div',null,bar);tabs.dataset.browserTabs='1';
  let state={environments:[],active:null},dragTab=null,busy=false,overlay;
  const current=()=>state.environments.find(e=>e.id===state.active);
  const field=(form,label,key,value='',type='text')=>{const l=create('label',label,form),n=create('input',null,l);n.dataset.browserField=key;n.type=type;n.value=value??'';return n;};
  const checkbox=(form,label,on)=>{const n=field(form,label,'', '', 'checkbox');n.checked=Boolean(on);return n;};
  const select=(form,label,choices,value)=>{const n=create('select',null,create('label',label,form));for(const [k,t]of choices){const o=create('option',t,n);o.value=k;}n.value=value;return n;};
  const button=(parent,text,title,action)=>{const b=create('button',text,parent);b.title=title;b.onclick=action;return b;};
  const reportError=e=>String(e.message||'操作失败').replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/,'');
  const invoke=async(op,args)=>{try{const s=await call(op,args);if(s?.environments){state=s;render();}return s;}catch(e){const n=document.querySelector('[data-browser-report]');if(n)n.textContent=reportError(e);else showError(reportError(e));return undefined;}};
  function showError(message){const b=button(bar,'连接提示',message,()=>dialog('浏览器环境',f=>create('p',message,f),current()?.id));b.dataset.browserError='1';}
  async function dialog(title,body,restore){
   if(overlay)return;await ipc.invoke('chatbridge:invoke','home');overlay=create('div',null,document.body);overlay.dataset.cbModal='1';const d=create('div',null,overlay);d.dataset.cbDialog='1';d.dataset.browserDialog='1';d.setAttribute('role','dialog');d.setAttribute('aria-modal','true');create('h2',title,d);
   const close=async(reactivate=true)=>{overlay?.remove();overlay=null;if(reactivate&&restore)await invoke('activate',{id:restore});};
   overlay.onclick=e=>{if(e.target===overlay)close();};overlay.onkeydown=e=>{if(e.key==='Escape')close();};
   try{await body(d,close);}catch(e){create('p',reportError(e),d);}button(d,'关闭','关闭窗口',()=>close());
  }
  function newEnvironment(){const previous=current()?.id;return dialog('新建浏览器环境',(form,close)=>{const name=field(form,'环境名称','environment-name','新环境'),report=create('span','',form);report.dataset.browserReport='1';const save=button(form,'创建环境','建立独立环境',async()=>{save.disabled=true;const r=await invoke('create',{name:name.value});save.disabled=false;if(r)await close(false);});name.focus();},previous);}
  function siteFields(form,e,run,saveSettings,close){
   create('h3','新增网站',form);
   const adapter=select(form,'类型',[['whatsapp','WhatsApp'],['website','自定义网站']],'website'),account=select(form,'会话',[['','新建独立账号会话'],...e.accounts.map(a=>[a.id,a.platform+' · '+a.name])],''),url=field(form,'网站 URL','url','https://'),platform=field(form,'平台名称','platform',''),name=field(form,'账号名称','account-name',''),note=field(form,'备注','note','');
   const change=()=>{const existing=e.accounts.find(a=>a.id===account.value),wa=(existing?.adapter||adapter.value)==='whatsapp';adapter.disabled=Boolean(existing);for(const f of [platform,name,note])f.disabled=Boolean(existing);if(wa)url.value='https://web.whatsapp.com/';else if(url.value==='https://web.whatsapp.com/')url.value='https://';};adapter.onchange=account.onchange=change;
   create('small','新增独立会话可登录另一个账号；选择已有会话将继续使用其登录状态。',form);
   button(form,'保存并添加网站','应用代理设置并打开网站',()=>run(async()=>{
    await saveSettings();
    const args={id:e.id,url:url.value};
    await call(account.value?'add-tab':'add-site',account.value?{...args,accountId:account.value}:{...args,adapter:adapter.value,platform:platform.value,name:name.value,note:note.value});
    await close(false);
   }));
  }
  function settings(e){return dialog('浏览器环境管理',async(form,close)=>{
   form.style.maxHeight='85vh';form.style.overflowY='auto';
   create('h3','代理 IP 与环境配置',form);
   const s=await call('settings',{id:e.id}),name=field(form,'环境名称','environment-name',s.name),p=s.proxy,f=s.profile;
   create('small','同一环境的所有账号会话使用这份代理和环境配置。保存会重新加载当前标签页。',form);
   const enabled=checkbox(form,'启用代理',p.enabled),protocol=select(form,'协议',[['http','HTTP'],['https','HTTPS'],['socks5','SOCKS5（无密码）']],p.protocol),host=field(form,'IP / 主机（可粘贴完整代理）','proxy-host',p.host),port=field(form,'端口','proxy-port',p.port),username=field(form,'用户名','proxy-user',p.username),password=field(form,'密码','proxy-password','','password');host.placeholder='IP:端口:用户名:密码';if(p.hasPassword)password.placeholder='已加密保存，留空保留';
   const fill=text=>{const x=parseProxyLine(text);if(!x)return false;enabled.checked=true;host.value=x.host;port.value=x.port;username.value=x.username;password.value=x.password;if(x.protocol)protocol.value=x.protocol;return true;};host.onpaste=event=>{if(fill(event.clipboardData?.getData('text/plain')))event.preventDefault();};host.oninput=()=>fill(host.value);
   const autoTimezone=checkbox(form,'时区跟随代理出口 IP',p.autoTimezone),timezone=field(form,'手动时区（关闭自动时）','timezone',p.timezone);timezone.placeholder='America/New_York';timezone.disabled=autoTimezone.checked;autoTimezone.onchange=()=>timezone.disabled=autoTimezone.checked;
   const languageMode=select(form,'语言来源',[['system','系统语言'],['ip','跟随出口 IP'],['manual','手动指定']],f.languageMode),language=field(form,'手动语言 / 自动匹配备选','language',f.language),geoMode=select(form,'地理位置',[['off','关闭'],['ip','使用出口 IP 近似位置'],['manual','手动坐标']],f.geoMode),latitude=field(form,'纬度（手动模式）','latitude',f.latitude,'number'),longitude=field(form,'经度（手动模式）','longitude',f.longitude,'number'),accuracy=field(form,'位置精度（米）','accuracy',f.accuracy,'number');latitude.step=longitude.step='any';
   create('small','UA、平台、屏幕与 CPU 显示原生检测值；Canvas、WebGL、字体未做内核替换。',form);const report=create('span','',form);report.dataset.browserReport='1';
   const values=()=>({id:e.id,name:name.value,proxy:{enabled:enabled.checked,protocol:protocol.value,host:host.value,port:port.value,username:username.value,password:password.value,keepPassword:p.hasPassword,autoTimezone:autoTimezone.checked,timezone:timezone.value},profile:{languageMode:languageMode.value,language:language.value,geoMode:geoMode.value,latitude:latitude.value===''?null:Number(latitude.value),longitude:longitude.value===''?null:Number(longitude.value),accuracy:Number(accuracy.value)}});
   const run=async task=>{if(busy)return;busy=true;report.textContent='正在处理…';try{await task();}catch(error){report.textContent=reportError(error);}finally{busy=false;}};
   const saveSettings=()=>call('save-settings',{...values(),deferActivation:true});
   button(form,'检测 IP','用当前表单中的代理检测出口 IP',()=>run(async()=>{
    const result=await call('check-proxy',values());
    report.textContent=`出口 IP：${result.ip} · 时区：${result.timezone}`;
   }));
   button(form,'保存并应用','保存当前环境设置',()=>run(async()=>{await saveSettings();await close();}));
   siteFields(form,e,run,saveSettings,close);
  },e.id);}
  function siteDetails(e){const tab=e.tabs.find(t=>t.id===e.activeTab),a=e.accounts.find(a=>a.id===tab?.accountId);if(!a)return;return dialog('网站账号与备注',(form,close)=>{const p=field(form,'平台名称','platform',a.platform),n=field(form,'账号名称','account-name',a.name),note=field(form,'备注','note',a.note);create('span','',form).dataset.browserReport='1';button(form,'保存','保存网站账号信息',async()=>{if(await invoke('site-details',{id:e.id,accountId:a.id,platform:p.value,name:n.value,note:note.value}))await close();});},e.id);}
  async function diagnose(e){if(busy)return;busy=true;let result;try{result=await call('diagnose',{id:e.id});}catch(error){result={error:reportError(error)};}finally{busy=false;}
   if(current()?.id!==e.id)return;
   await dialog('指纹概览与一致性检测',form=>{const report=create('div',null,form);report.dataset.browserReport='1';if(result.error){report.textContent=result.error;return;}const observed=result.values[0]?.observed;const lines=[`环境：${e.name}（配置版本 ${e.revision}）`,`Chromium：${state.engines?.chromium||'未检测'}`,`检测时间：${new Date(result.checkedAt).toLocaleString()}`,`已检测标签：${result.values.length} / ${e.tabs.length}`,`检查结果：${result.consistent?'已检查项一致':'发现差异，请检查配置'}`,`代理：${result.proxyEnabled?'已启用':'未启用（未查询出口 IP）'}`];for(const x of result.checks)lines.push(`账号出口：${x.ip||'未检测'} · ${x.timezone||'—'}${x.failed?' · 检测失败或出口变化':''}`);if(observed){lines.push(`实际时区：${observed.timezone}`,`实际语言：${observed.languages.join(', ')} / Intl ${observed.locale}`,`平台：${observed.platform} · CPU：${observed.cores}`,`屏幕：${observed.screen.width} × ${observed.screen.height} · DPR ${observed.screen.dpr}`,`UA：${observed.userAgent}`);}for(const x of result.values){lines.push(`标签检查：时区 ${x.timezoneMatches?'一致':'不一致'} · 语言 ${x.languageMatches&&x.localeMatches?'一致':'不一致'} · 位置 ${x.geoMatches===null?'未检测':x.geoMatches?'一致':'不一致'}`);if(x.configured.geo)lines.push(`配置位置：${x.configured.geo.latitude}, ${x.configured.geo.longitude}（精度 ${x.configured.geo.accuracy} 米）`);if(x.observed.geo)lines.push(`页面位置：${x.observed.geo.latitude}, ${x.observed.geo.longitude}`);}lines.push('位置为近似配置；Canvas / WebGL / 字体保留原生能力。');report.textContent=lines.join('\n');},e.id);
  }
  button(workspace,'＋ 浏览器环境','新建多网站浏览器环境',newEnvironment);
  function render(){
   if(dragTab)return;
   envList.replaceChildren();envList.hidden=state.environments.length===0&&!state.errors?.length;for(const message of state.errors||[])create('small',message,envList);for(const e of state.environments){const b=button(envList,'◈ '+e.name+(e.unread?' · '+e.unread:''),e.message||e.name,()=>invoke('activate',{id:e.id}));b.dataset.browserEnvironment=e.id;b.dataset.active=String(e.id===state.active);if(e.unread)b.style.color='#ff586e';}
   const e=current();document.body.toggleAttribute('data-browser-active',Boolean(e));bar.hidden=!e;tabs.replaceChildren();for(const n of [...bar.children])if(n!==tabs)n.remove();if(!e)return;
   for(const t of e.tabs){const a=e.accounts.find(x=>x.id===t.accountId),row=create('div',null,tabs);row.dataset.browserTab=t.id;row.dataset.active=String(t.id===e.activeTab);row.draggable=true;
    button(row,t.title||a?.name||t.url,t.url,()=>invoke('activate',{id:e.id,tab:t.id}));button(row,'×','关闭标签',()=>invoke('close',{id:e.id,tab:t.id})).draggable=false;
    row.ondragstart=event=>{if(event.target.textContent==='×'){event.preventDefault();return;}dragTab=t.id;event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',t.id);};row.ondragend=()=>{dragTab=null;render();};row.ondragover=event=>{if(dragTab)event.preventDefault();};row.ondrop=event=>{if(!dragTab)return;event.preventDefault();const source=dragTab;dragTab=null;invoke('move',{id:e.id,tab:source,index:e.tabs.indexOf(t)});};
   }
   if(!e.tabs.length)create('span','添加一个网站开始',tabs);else if(e.state!=='ready'&&e.message){const n=create('span',e.message,tabs);n.style.cssText='font-size:11px;color:#ffbf69;white-space:nowrap;';}
   if(e.activeTab){button(bar,'↻','刷新当前标签',()=>invoke('refresh',{id:e.id}));button(bar,'⧉','复制标签，共用原账号会话',()=>invoke('duplicate',{id:e.id,tab:e.activeTab}));button(bar,'账号','平台名称、账号名称和备注',()=>siteDetails(e));}
   button(bar,'检测','指纹概览与网络一致性检测',()=>diagnose(e));button(bar,'环境管理','设置代理 IP、检测 IP 和新增网站',()=>settings(e));
  }
  ipc.on('chatbridge:browser-state',(_e,s)=>{if(s?.environments){state=s;render();}});invoke('restore');
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});else mount();
}
module.exports={installBrowserUI};
