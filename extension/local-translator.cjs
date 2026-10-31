// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const path=require('node:path'),fs=require('node:fs'),readline=require('node:readline');
function createTranslator({resources=process.resourcesPath,spawn=require('node:child_process').spawn,timeout=120000}={}){
 const exe=path.join(resources,'local-translation','ChatBridgeTranslator.exe'),models=path.join(resources,'local-models');
 let child=null,queue=Promise.resolve(),next=0;const pending=new Map();
 function stop(message='本地翻译引擎已关闭，请重试。'){const old=child;child=null;for(const p of pending.values()){clearTimeout(p.timer);p.reject(new Error(message));}pending.clear();old?.kill();}
 function start(){
  if(child)return;
  if(!fs.existsSync(exe)||!['en-zh','zh-en'].every(d=>fs.existsSync(path.join(models,d,'model','model.bin'))))throw new Error('本地模型缺失，请安装完整的离线翻译版本。');
  const proc=spawn(exe,['--models',models],{stdio:['pipe','pipe','ignore'],windowsHide:true});child=proc;
  proc.stdin.on('error',()=>{if(child===proc)stop('本地翻译引擎连接中断，请重试。');});
  readline.createInterface({input:proc.stdout}).on('line',line=>{let r;try{r=JSON.parse(line);}catch{return;}const p=pending.get(r.id);if(!p)return;pending.delete(r.id);clearTimeout(p.timer);if(typeof r.text==='string')p.resolve(r.text);else p.reject(new Error(r.error||'本地翻译失败。'));});
  proc.on('error',()=>{if(child===proc)stop('本地翻译引擎启动失败，请重新安装完整版本。');});
  proc.on('exit',()=>{if(child===proc)stop('本地翻译引擎已退出，请重试。');});
 }
 return {translate(text,target){const job=queue.then(()=>new Promise((resolve,reject)=>{try{start();const id=++next,timer=setTimeout(()=>stop('本地翻译超时，请缩短消息后重试。'),timeout);pending.set(id,{resolve,reject,timer});child.stdin.write(JSON.stringify({id,text,target})+'\n');}catch(e){reject(e);}}));queue=job.catch(()=>{});return job;},close:()=>stop()};
}
module.exports={createTranslator};
