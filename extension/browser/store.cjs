// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const id=value=>{if(typeof value!=='string'||!UUID.test(value))throw Error('环境或账号编号无效。');return value;};
const label=(value,limit=80)=>{if(typeof value!=='string'||value.trim().length>limit)throw Error('名称或备注格式无效。');return value.trim();};
const defaults=()=>({languageMode:'system',language:'en-US',geoMode:'off',latitude:null,longitude:null,accuracy:50000});
function profile(value){
 const v={...defaults(),...value};if(!['system','ip','manual'].includes(v.languageMode)||!['off','ip','manual'].includes(v.geoMode))throw Error('环境配置选项无效。');
 let language;try{language=Intl.getCanonicalLocales(v.language)[0];if(!language||language.length>35)throw Error();}catch{throw Error('语言无效，例如 en-US 或 zh-CN。');}
 if(v.geoMode==='manual'&&(!Number.isFinite(v.latitude)||Math.abs(v.latitude)>90||!Number.isFinite(v.longitude)||Math.abs(v.longitude)>180||!Number.isFinite(v.accuracy)||v.accuracy<1||v.accuracy>1000000))throw Error('地理位置无效，请检查经纬度和精度。');
 return {languageMode:v.languageMode,language,geoMode:v.geoMode,latitude:v.geoMode==='manual'?v.latitude:null,longitude:v.geoMode==='manual'?v.longitude:null,accuracy:v.geoMode==='manual'?v.accuracy:50000};
}
function atomic(file,value){const tmp=file+'.'+randomUUID()+'.tmp';try{fs.writeFileSync(tmp,JSON.stringify(value),{flag:'wx',mode:0o600});fs.renameSync(tmp,file);}finally{fs.rmSync(tmp,{force:true});}}
function createStore(root,adapters){
 const records=new Map(),errors=[];fs.mkdirSync(root,{recursive:true});const location=key=>path.join(root,id(key),'environment.json');
 function validate(e,key){
  if(!e||e.schemaVersion!==1||e.id!==key||!Number.isSafeInteger(e.revision)||e.revision<1||!Array.isArray(e.accounts)||!Array.isArray(e.tabs))throw Error('环境配置版本或内容无效。');
  if(!label(e.name))throw Error('环境名称不能为空。');profile(e.profile);
  if(!e.proxy||typeof e.proxy.enabled!=='boolean')throw Error('环境代理配置无效。');
  const accountIds=new Set(),tabIds=new Set();for(const a of e.accounts){id(a.id);if(accountIds.has(a.id)||!Object.hasOwn(adapters,a.adapter))throw Error('网站账号配置无效。');accountIds.add(a.id);label(a.platform);label(a.name);label(a.note,500);}
  for(const t of e.tabs){id(t.id);if(tabIds.has(t.id)||!accountIds.has(t.accountId))throw Error('标签页引用无效。');tabIds.add(t.id);adapters[e.accounts.find(a=>a.id===t.accountId).adapter].url(t.url);}
  if(e.activeTab!==null&&!tabIds.has(e.activeTab))throw Error('活动标签页不存在。');return e;
 }
 for(const entry of fs.readdirSync(root,{withFileTypes:true})){
  if(!entry.isDirectory()||!UUID.test(entry.name))continue;const file=location(entry.name);
  if(fs.existsSync(file+'.purge')){
   try{purgeDirectory(entry.name);}catch{errors.push('有环境的数据仍被占用，彻底删除将在下次启动时重试。');}
   continue;
  }
  if(!fs.existsSync(file))continue;
  let raw;try{raw=JSON.parse(fs.readFileSync(file,'utf8'));}catch{}
  try{records.set(entry.name,validate(raw,entry.name));}catch{
   try{if(raw&&raw.schemaVersion!==1)throw Error();records.set(entry.name,validate(JSON.parse(fs.readFileSync(file+'.bak','utf8')),entry.name));errors.push('已恢复一个环境的上一版配置。');}
   catch{errors.push('有环境配置无法读取，原文件已保留。');}
  }
 }
 function get(key){const e=records.get(id(key));if(!e)throw Error('浏览器环境不存在。');return structuredClone(e);}
 function save(e){validate(e,e.id);const file=location(e.id);fs.mkdirSync(path.dirname(file),{recursive:true});if(records.has(e.id))atomic(file+'.bak',records.get(e.id));atomic(file,e);records.set(e.id,structuredClone(e));return structuredClone(e);}
 function edit(key,fn,{settings=false}={}){const e=get(key);fn(e);if(settings)e.revision++;return save(e);}
 function purgeDirectory(key){
  const file=location(key),dir=path.dirname(file);
  // Keep the marker until every other entry has been removed successfully.
  for(const entry of fs.readdirSync(dir)){
   if(entry!=='environment.json.purge')fs.rmSync(path.join(dir,entry),{recursive:true,force:true,maxRetries:3});
  }
  fs.rmSync(file+'.purge');fs.rmdirSync(dir);
 }
 function remove(key,permanent){
  const e=get(key),file=location(key);
  if(permanent){atomic(file+'.purge',{pending:true});}
  else{save({...e,archived:true});}
  if(permanent)records.delete(key);
  if(permanent){try{purgeDirectory(key);}catch{errors.push('有环境的数据仍被占用，彻底删除将在下次启动时重试。');}}
 }
 return {root,errors,get,remove,list:()=>[...records.values()].map(e=>structuredClone(e)),create(name){return save({schemaVersion:1,id:randomUUID(),name:label(name),revision:1,proxy:{enabled:false},profile:defaults(),accounts:[],tabs:[],activeTab:null});},edit,
  sessionPath(key,account){const e=get(key);if(!e.accounts.some(a=>a.id===account))throw Error('网站账号不存在。');return path.join(root,id(key),'sessions',id(account));},
  selected(){try{const v=JSON.parse(fs.readFileSync(path.join(root,'selected.json'),'utf8'));return records.has(v.id)&&!records.get(v.id).archived?v.id:null;}catch{return null;}},select(key){if(key!==null)get(key);atomic(path.join(root,'selected.json'),{id:key});},
  addSite(key,v){return edit(key,e=>{const adapter=Object.hasOwn(adapters,v.adapter)&&adapters[v.adapter];if(!adapter)throw Error('平台类型无效。');const url=adapter.url(v.url),account={id:randomUUID(),adapter:v.adapter,platform:label(v.platform||adapter.label),name:label(v.name||adapter.label),note:label(v.note||'',500)};e.accounts.push(account);const tab={id:randomUUID(),accountId:account.id,url};e.tabs.push(tab);e.activeTab=tab.id;});},
  addTab(key,accountId,url){return edit(key,e=>{const account=e.accounts.find(a=>a.id===accountId);if(!account)throw Error('网站账号不存在。');const tab={id:randomUUID(),accountId,url:adapters[account.adapter].url(url)};e.tabs.push(tab);e.activeTab=tab.id;});},
  duplicate(key,tabId){const e=get(key),tab=e.tabs.find(t=>t.id===tabId);if(!tab)throw Error('标签页不存在。');return edit(key,e=>{const copy={...tab,id:randomUUID()};e.tabs.splice(e.tabs.findIndex(t=>t.id===tabId)+1,0,copy);e.activeTab=copy.id;});},
  close(key,tabId){return edit(key,e=>{const i=e.tabs.findIndex(t=>t.id===tabId);if(i<0)throw Error('标签页不存在。');e.tabs.splice(i,1);if(e.activeTab===tabId)e.activeTab=e.tabs[Math.min(i,e.tabs.length-1)]?.id||null;});},
  move(key,tabId,index){return edit(key,e=>{const from=e.tabs.findIndex(t=>t.id===tabId);if(from<0||!Number.isInteger(index)||index<0||index>=e.tabs.length)throw Error('标签页顺序无效。');e.tabs.splice(index,0,e.tabs.splice(from,1)[0]);});},
 };
}
module.exports={createStore,profile,defaults,id,label};
