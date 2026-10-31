// SPDX-License-Identifier: AGPL-3.0-only
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),os=require('node:os');
const {createTranslator}=require('../extension/local-translator.cjs');
(async()=>{
 const original=path.resolve('signal-source/release/win-unpacked/resources');
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ChatBridge-'));
 const unicode=path.join(temp,'中文 用户','ChatBridge Resources');
 try{
  for(const dir of ['local-translation','local-models'])fs.cpSync(path.join(original,dir),path.join(unicode,dir),{recursive:true});
  for(const resources of [original,unicode]){
   const t=createTranslator({resources});try{
    const zh=await t.translate('Honey. What problem are you encountering? Please let me know the details','zh-Hans');
    const en=await t.translate('你好，今天过得怎么样？','en');
    assert(/[\u3400-\u9fff]/.test(zh));assert(/[A-Za-z]/.test(en)&&!/[\u3400-\u9fff▁]/.test(en));assert(!zh.includes('▁'));
    for(const text of ['Gave up?',"Guess that’s because I am",'See https://example.com 😀'])assert((await t.translate(text,'zh-Hans')).trim());
    const start=performance.now();
    const messages=['Good morning. How are you?','Please send me the details.','Thank you for telling me.','What time should we meet?','See you tomorrow.','Have a wonderful day.','I am on my way home.','It was nice to see you again.'];
    const translated=await Promise.all(messages.map(text=>t.translate(text,'zh-Hans')));
    assert(translated.every(text=>/[\u3400-\u9fff]/.test(text)));
    const batchMs=performance.now()-start,cachedStart=performance.now();
    const cached=await Promise.all(messages.map(text=>t.translate(text,'zh-Hans')));assert.deepEqual(cached,translated);
    console.log('OFFLINE_SPEED_SAMPLE',JSON.stringify({messages:messages.length,batchMs:Math.round(batchMs),cachedMs:Math.round(performance.now()-cachedStart)}));
    console.log('Packaged offline translation passed:',resources===unicode?'Chinese username and spaces':'standard install path');
   }finally{t.close();}
  }
 }finally{await new Promise(r=>setTimeout(r,1000));fs.rmSync(temp,{recursive:true,force:true,maxRetries:5,retryDelay:500});}
})().catch(e=>{console.error(e);process.exitCode=1;});
