// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const path=require('node:path'),fs=require('node:fs'),readline=require('node:readline');
function createTranslator({resources=process.resourcesPath,spawn=require('node:child_process').spawn,timeout=120000,batchDelay=12}={}){
 const exe=path.join(resources,'local-translation',process.platform==='win32'?'ChatBridgeTranslator.exe':'ChatBridgeTranslator'),models=path.join(resources,'local-models');
 let child=null,active=null,timer=null,next=0,closed=false,cacheChars=0;
 const queue=[],inflight=new Map(),cache=new Map();
 function finish(job,error,text){inflight.delete(job.key);if(error)job.reject(error);else{
  cache.set(job.key,text);cacheChars+=job.key.length+text.length;
  while(cache.size>512||cacheChars>2000000){const key=cache.keys().next().value;cacheChars-=key.length+cache.get(key).length;cache.delete(key);}job.resolve(text);
 }}
 function stop(message){clearTimeout(timer);timer=null;const old=child;child=null;const jobs=[...(active?.jobs||[]),...queue.splice(0)];clearTimeout(active?.timer);active=null;for(const job of jobs)finish(job,new Error(message));old?.kill();}
 function start(){
  if(child)return;
  if(!fs.existsSync(exe)||!['en-zh','zh-en'].every(d=>fs.existsSync(path.join(models,d,'model','model.bin'))))throw new Error('本地模型缺失，请安装完整的离线翻译版本。');
  const proc=spawn(exe,['--models',models],{stdio:['pipe','pipe','ignore'],windowsHide:true});child=proc;
  proc.stdin.on('error',()=>{if(child===proc)stop('本地翻译引擎连接中断，请重试。');});
  readline.createInterface({input:proc.stdout}).on('line',line=>{
   let r;try{r=JSON.parse(line);}catch{return;}
   if(!active||r.id!==active.id)return;const batch=active;active=null;clearTimeout(batch.timer);
   batch.jobs.forEach((job,i)=>{const result=r.results?.[i];if(typeof result?.text==='string')finish(job,null,result.text);else finish(job,new Error(result?.error||r.error||'本地翻译失败。'));});schedule();
  });
  proc.on('error',()=>{if(child===proc)stop('本地翻译引擎启动失败，请重新安装完整版本。');});
  proc.on('exit',()=>{if(child===proc)stop('本地翻译引擎已退出，请重试。');});
 }
 function schedule(){if(timer||active||closed||!queue.length)return;timer=setTimeout(pump,batchDelay);}
 function pump(){
  timer=null;if(active||closed||!queue.length)return;
  // Bound a batch to avoid a large historical paragraph holding many short messages.
  const jobs=[];let size=0;
  while(queue.length&&jobs.length<8){const job=queue[0];if(jobs.length&&size+job.text.length>2400)break;jobs.push(queue.shift());size+=job.text.length;}
  try{start();const id=++next;active={id,jobs,timer:setTimeout(()=>stop('本地翻译超时，请缩短消息后重试。'),timeout)};child.stdin.write(JSON.stringify({id,items:jobs.map(({text,target})=>({text,target}))})+'\n');}
  catch(error){clearTimeout(active?.timer);active=null;for(const job of jobs)finish(job,error);schedule();}
 }
 return {
  translate(text,target){
   if(closed)return Promise.reject(new Error('翻译引擎已关闭。'));
   const key=target+'\0'+text;
   if(cache.has(key)){const value=cache.get(key);cache.delete(key);cache.set(key,value);return Promise.resolve(value);}
   if(inflight.has(key))return inflight.get(key);
   let resolve,reject;const promise=new Promise((r,j)=>{resolve=r;reject=j;});inflight.set(key,promise);queue.push({key,text,target,resolve,reject});schedule();return promise;
  },
  warmup(){return this.translate('Hello','zh-Hans');},
  close(){closed=true;stop('本地翻译引擎已关闭。');cache.clear();cacheChars=0;}
 };
}
module.exports={createTranslator};
