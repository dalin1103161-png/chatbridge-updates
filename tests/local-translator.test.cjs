// SPDX-License-Identifier: AGPL-3.0-only
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {EventEmitter}=require('node:events'),{PassThrough}=require('node:stream');
const {createTranslator}=require('../extension/local-translator.cjs');
function fixture(reply=true,timeout=1000){
 const resources=fs.mkdtempSync(path.join(os.tmpdir(),'cb-batch-'));
 for(const d of ['local-translation','local-models/en-zh/model','local-models/zh-en/model'])fs.mkdirSync(path.join(resources,d),{recursive:true});
 fs.writeFileSync(path.join(resources,'local-translation',process.platform==='win32'?'ChatBridgeTranslator.exe':'ChatBridgeTranslator'),'');for(const d of ['en-zh','zh-en'])fs.writeFileSync(path.join(resources,'local-models',d,'model/model.bin'),'');
 const requests=[];let spawned=0;
 const t=createTranslator({resources,timeout,batchDelay:2,spawn:()=>{spawned++;const p=new EventEmitter();p.stdin=new PassThrough();p.stdout=new PassThrough();p.kill=()=>{p.stdin.destroy();p.stdout.destroy();};p.stdin.on('data',buf=>{const request=JSON.parse(String(buf));requests.push(request);if(reply)setImmediate(()=>p.stdout.write(JSON.stringify({id:request.id,results:request.items.map(x=>x.text==='fail'?{error:'Expected item failure'}:{text:x.target+':'+x.text})})+'\n'));});return p;}});
 return {t,requests,get spawned(){return spawned;},close(){t.close();fs.rmSync(resources,{recursive:true,force:true});}};
}
test('coalesces simultaneous history requests and caches completed results',async()=>{
 const f=fixture();try{const texts=Array.from({length:8},(_,i)=>'Message '+i);const out=await Promise.all(texts.map(x=>f.t.translate(x,'zh-Hans')));assert.equal(f.requests.length,1);assert.equal(f.requests[0].items.length,8);assert.equal(out[7],'zh-Hans:Message 7');assert.equal(await f.t.translate(texts[0],'zh-Hans'),out[0]);assert.equal(f.requests.length,1);assert.equal(f.spawned,1);}finally{f.close();}
});
test('deduplicates in-flight requests and keeps language-specific cache keys',async()=>{
 const f=fixture();try{const a=f.t.translate('Hello','zh-Hans'),b=f.t.translate('Hello','zh-Hans');assert.equal(a,b);await a;await f.t.translate('Hello','en');assert.equal(f.requests.length,2);}finally{f.close();}
});
test('an item failure does not discard the other translations in a batch',async()=>{
 const f=fixture();try{const result=await Promise.allSettled([f.t.translate('fail','zh-Hans'),f.t.translate('works','zh-Hans')]);assert.equal(result[0].status,'rejected');assert.equal(result[1].value,'zh-Hans:works');assert.equal(f.requests.length,1);}finally{f.close();}
});
test('timeout rejects active and queued requests instead of leaving a blocked queue',async()=>{
 const f=fixture(false,25);try{const jobs=Array.from({length:10},(_,i)=>f.t.translate('Message '+i,'en'));const results=await Promise.allSettled(jobs);assert(results.every(r=>r.status==='rejected'&&/超时/.test(r.reason.message)));}finally{f.close();}
});
