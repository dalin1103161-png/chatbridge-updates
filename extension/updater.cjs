// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const {Readable}=require('node:stream');
const {pipeline}=require('node:stream/promises');
const API='https://api.github.com/repos/dalin1103161-png/chatbridge-updates';
function validateManifest(m,build){
 if(!m||!Number.isSafeInteger(m.build)||m.build<=build||!Number.isSafeInteger(m.assetId)||m.assetId<=0||!Number.isSafeInteger(m.size)||m.size<1||m.size>1073741824||!/^[a-f0-9]{64}$/.test(m.sha256))throw Error('更新清单无效或版本不高于当前版本。');
 return m;
}
// Only directories created by this updater and carrying its marker are eligible.
// Never walk account data or user download folders; Windows may lock an active installer.
function cleanupUpdateCache(root,currentBuild,now=Date.now()) {
 const summary={removed:0,skipped:0};
 if(!fs.existsSync(root))return summary;
 if(fs.lstatSync(root).isSymbolicLink())return summary;
 for(const name of fs.readdirSync(root)){
  if(!/^package-[A-Za-z0-9]{6}$/.test(name))continue;
  const directory=path.join(root,name);
  try{
   const stat=fs.lstatSync(directory);if(!stat.isDirectory()||stat.isSymbolicLink())continue;
   const marker=path.join(directory,'update.json');
   if(fs.lstatSync(marker).isSymbolicLink())continue;
   const record=JSON.parse(fs.readFileSync(marker,'utf8'));
   if(record.owner!=='ChatBridgeUpdater-v1'||!Number.isSafeInteger(record.build)||record.build<1||!Number.isFinite(record.createdAt))continue;
   const installed=record.build<=currentBuild;
   const stale=now-record.createdAt>7*24*60*60*1000;
   if(!installed&&!stale){summary.skipped++;continue;}
   fs.rmSync(directory,{recursive:true,force:true});summary.removed++;
  }catch{summary.skipped++;}
 }
 return summary;
}
function createUpdater({app,spawn,notify,rootDir,fetchImpl=fetch}){
 const meta=JSON.parse(fs.readFileSync(path.join(rootDir,'chatbridge/source-manifest.json'),'utf8'));
 const cacheRoot=path.join(app.getPath('temp'),'ChatBridgeUpdateCache');
 const cleanup=cleanupUpdateCache(cacheRoot,meta.build||0);
 let latest=null,busy=false;
 const state={status:'idle',currentBuild:meta.build||0,signalVersion:meta.tag,available:false,message:'',cleanedPackages:cleanup.removed};
 const emit=patch=>{Object.assign(state,patch);notify({...state});return {...state};};
 const request=async(url,accept='application/vnd.github+json')=>{
  const response=await fetchImpl(url,{headers:{Accept:accept,'X-GitHub-Api-Version':'2022-11-28'},signal:AbortSignal.timeout(180000)});
  if(!response.ok)throw Error(response.status===404||response.status===401?'公开更新源暂不可用，可能尚未发布版本。请稍后重试。':'更新服务器错误：HTTP '+response.status);
  return response;
 };
 return {
  state:()=>({...state,publicUpdates:true}),
  async check(){
   if(busy)return {...state};busy=true;latest=null;emit({status:'checking',available:false,message:'正在检查更新'});
   try{
    const release=await (await request(API+'/releases/latest')).json();
    if(release.draft||release.prerelease)throw Error('没有可安装的正式更新。');
    const asset=release.assets?.find(a=>a.name==='chatbridge-update.json');if(!asset||!Number.isSafeInteger(asset.id))throw Error('此版本尚未提供更新清单。');
    const m=await (await request(API+'/releases/assets/'+asset.id,'application/octet-stream')).json();
    if(Number.isSafeInteger(m.build)&&m.build<=(meta.build||0))return emit({status:'current',available:false,message:'已是当前发布的最新版本'});
    validateManifest(m,meta.build||0);
    if(!release.assets.some(a=>a.id===m.assetId&&a.size===m.size&&a.name==='ChatBridge-Setup.exe'))throw Error('更新文件与发布记录不匹配。');
    latest=m;return emit({status:'available',available:true,latestBuild:m.build,message:'有新版 ChatBridge 可安装（包含 Signal 内核）'});
   }catch(e){return emit({status:'error',available:false,message:e.message});}finally{busy=false;}
  },
  async install(){
   if(busy||!latest)throw Error('请先检查并选择可用更新。');if(process.platform!=='win32')throw Error('此更新仅支持 Windows。');
   busy=true;emit({status:'downloading',message:'正在下载更新，请勿关闭应用'});
   cleanupUpdateCache(cacheRoot,meta.build||0);
   fs.mkdirSync(cacheRoot,{recursive:true});
   if(fs.lstatSync(cacheRoot).isSymbolicLink()) { busy=false;throw Error('更新缓存目录无效。'); }
   const directory=fs.mkdtempSync(path.join(cacheRoot,'package-'));const file=path.join(directory,'ChatBridge-Setup.exe');
   try{
    fs.writeFileSync(path.join(directory,'update.json'),JSON.stringify({owner:'ChatBridgeUpdater-v1',build:latest.build,createdAt:Date.now()}),{flag:'wx',mode:0o600});
    const response=await request(API+'/releases/assets/'+latest.assetId,'application/octet-stream');
    const hash=crypto.createHash('sha256');let size=0;
    const stream=Readable.fromWeb(response.body);stream.on('data',chunk=>{size+=chunk.length;hash.update(chunk);if(size>latest.size)stream.destroy(Error('更新包大小异常。'));});
    await pipeline(stream,fs.createWriteStream(file,{flags:'wx'}));
    if(size!==latest.size||hash.digest('hex')!==latest.sha256)throw Error('更新包校验失败，未运行安装程序。');
    // Standard installer handles running instances; no chat directories are copied or removed here.
    const child=spawn(file,[],{detached:true,stdio:'ignore',windowsHide:false});
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});child.unref();
    emit({status:'installing',available:false,message:'安装程序已打开，请按提示完成更新'});app.quit();return true;
   }catch(e){try{fs.rmSync(directory,{recursive:true,force:true});}catch{}emit({status:'error',message:e.message});throw e;}finally{busy=false;}
  }
 };
}
module.exports={createUpdater,validateManifest,cleanupUpdateCache};
