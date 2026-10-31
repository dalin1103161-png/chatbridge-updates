// SPDX-License-Identifier: AGPL-3.0-only
const test=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {validateManifest,createUpdater}=require('../extension/updater.cjs');
test('rejects downgrade, invalid asset IDs, oversized packages and malformed hashes',()=>{
 const m={build:2,assetId:123,size:100,sha256:'a'.repeat(64)};
 assert.equal(validateManifest(m,1),m);
 for(const patch of [{build:1},{assetId:-1},{size:1073741825},{sha256:'invalid'}])assert.throws(()=>validateManifest({...m,...patch},1));
});
test('public update check matches installer metadata and never sends credentials',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cb-update-test-'));
 try{
 fs.mkdirSync(path.join(dir,'chatbridge'));fs.writeFileSync(path.join(dir,'chatbridge/source-manifest.json'),JSON.stringify({build:1,tag:'v8.33.0'}));
 const requests=[],events=[];const m={build:2,assetId:22,size:100,sha256:'b'.repeat(64)};
 const updater=createUpdater({app:{getPath:()=>dir},rootDir:dir,safeStorage:{isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from('encrypted:'+s),decryptString:b=>b.toString().slice(10)},notify:s=>events.push(s),spawn:()=>{throw Error('must not execute during check');},fetchImpl:async(url,opts)=>{requests.push({url,opts});return {ok:true,json:async()=>url.endsWith('/latest')?{assets:[{id:11,name:'chatbridge-update.json'},{id:22,name:'ChatBridge-Setup.exe',size:100}]}:m};}});
 const result=await updater.check();
 assert.equal(result.available,true);assert.equal(result.latestBuild,2);
 assert(requests.every(r=>r.url.startsWith('https://api.github.com/repos/dalin1103161-png/chatbridge-updates/')));
 assert(requests.every(r=>!('Authorization' in r.opts.headers)));
 assert.equal(updater.state().publicUpdates,true);
 m.build=1;assert.equal((await updater.check()).status,'current');
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('cleanup removes completed updates and seven-day remnants but preserves pending, foreign and account files',()=>{
 const {cleanupUpdateCache}=require('../extension/updater.cjs');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cb-cache-test-'));const now=Date.now();
 try{
  const make=(name,build,age,owner='ChatBridgeUpdater-v1')=>{const d=path.join(root,name);fs.mkdirSync(d);fs.writeFileSync(path.join(d,'update.json'),JSON.stringify({owner,build,createdAt:now-age}));fs.writeFileSync(path.join(d,'ChatBridge-Setup.exe'),'installer');};
  make('package-aaaaaa',2,1000);make('package-bbbbbb',3,1000);make('package-cccccc',4,8*86400000);make('package-dddddd',1,1000,'unrelated');
  fs.mkdirSync(path.join(root,'account-data'));fs.writeFileSync(path.join(root,'account-data','db.sqlite'),'chat data');
  fs.mkdirSync(path.join(root,'package-eeeeee'));fs.writeFileSync(path.join(root,'package-eeeeee','ChatBridge-Setup.exe'),'unmarked');
  const result=cleanupUpdateCache(root,2,now);assert.equal(result.removed,2);
  assert(!fs.existsSync(path.join(root,'package-aaaaaa')));assert(!fs.existsSync(path.join(root,'package-cccccc')));
  for(const name of ['package-bbbbbb','package-dddddd','package-eeeeee','account-data'])assert(fs.existsSync(path.join(root,name)));
  assert.equal(fs.readFileSync(path.join(root,'account-data','db.sqlite'),'utf8'),'chat data');
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
