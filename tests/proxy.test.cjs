// SPDX-License-Identifier: AGPL-3.0-only
const test=require('node:test'),assert=require('node:assert/strict'),{EventEmitter}=require('node:events');
const {validate,credentials,publicConfig,createProxyController,timezone}=require('../extension/proxy.cjs');
const storage={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s).map(x=>x^53),decryptString:b=>Buffer.from(b).map(x=>x^53).toString()};
const fields={enabled:true,host:'127.0.0.1',port:'8080',protocol:'http',username:'fixture-user',password:'fixture-secret',autoTimezone:true};
test('proxy passwords are protected and omitted from renderer settings; blank edit can retain them',()=>{
 const c=validate(fields,null,storage);assert(!JSON.stringify(c).includes(fields.password));assert.equal(credentials(c,storage).password,fields.password);assert.equal(publicConfig(c,storage).password,undefined);assert(publicConfig(c,storage).hasPassword);const next=validate({...fields,password:'',keepPassword:true},c,storage);assert.equal(credentials(next,storage).password,fields.password);
 assert.throws(()=>validate({...fields,port:0},null,storage));assert.throws(()=>validate({...fields,host:'x;DIRECT'},null,storage));assert.throws(()=>validate({...fields,protocol:'socks5'},null,storage));assert.throws(()=>validate(fields,null,{isEncryptionAvailable:()=>false}));assert.throws(()=>timezone('not/a/timezone'));
});
function fixture(lookup){const wc=new EventEmitter(),calls=[];wc.stop=()=>calls.push('stop');wc.setWebRTCIPHandlingPolicy=p=>calls.push(['webrtc',p]);wc.debugger=Object.assign(new EventEmitter(),{isAttached:()=>false,attach:()=>calls.push('attach'),sendCommand:async(method,v)=>calls.push([method,v])});wc.session={closeAllConnections:async()=>calls.push('close'),clearAuthCache:async()=>{},setProxy:async v=>calls.push(['proxy',v]),webRequest:{onBeforeRequest:f=>wc.gate=f}};return {wc,calls,c:createProxyController(wc,{lookup,safeStorage:storage})};}
test('routing and timezone must succeed before requests are allowed, with no DIRECT fallback',async()=>{
 const f=fixture(async()=>({ip:'203.0.113.1',timezone:'America/New_York'}));let cancelled;f.wc.gate({url:'https://web.whatsapp.com'},v=>cancelled=v.cancel);assert(cancelled);
 await f.c.configure(validate(fields,null,storage));f.wc.gate({url:'https://web.whatsapp.com'},v=>cancelled=v.cancel);assert.equal(cancelled,false);const p=f.calls.find(v=>v[0]==='proxy')[1];assert(!p.proxyRules.includes('DIRECT'));assert.equal(p.proxyBypassRules,'<-loopback>');assert.deepEqual(f.calls.find(v=>v[0]==='Emulation.setTimezoneOverride')[1],{timezoneId:'America/New_York'});assert.equal(f.c.state().ip,'203.0.113.1');
});
test('failed detection and detached timezone block an account instead of loading it with default routing',async()=>{
 const f=fixture(async()=>{throw Error('private error must not reach UI');});await assert.rejects(f.c.configure(validate(fields,null,storage)),/暂停/);assert(!JSON.stringify(f.c.state()).includes('private error'));let blocked;f.wc.gate({url:'https://web.whatsapp.com'},v=>blocked=v.cancel);assert(blocked);
 const g=fixture(async()=>({ip:'203.0.113.2',timezone:'Europe/Warsaw'}));await g.c.configure(validate(fields,null,storage));g.wc.debugger.emit('detach');assert.equal(g.c.state().state,'blocked');
});
test('proxy authentication is scoped to the matching proxy challenge only',async()=>{
 const f=fixture(async()=>({ip:'203.0.113.1',timezone:'UTC'}));await f.c.configure(validate(fields,null,storage));let received;const callback=(...v)=>received=v;
 f.wc.emit('login',{preventDefault(){}},{},{isProxy:true,host:'127.0.0.1',port:8080},callback);assert.deepEqual(received,[fields.username,fields.password]);f.wc.emit('login',{preventDefault(){}},{},{isProxy:true,host:'other',port:8080},callback);assert.deepEqual(received,[]);
 received=undefined;f.wc.emit('login',{preventDefault(){throw Error();}},{},{isProxy:false,host:'127.0.0.1',port:8080},callback);assert.equal(received,undefined);
});
