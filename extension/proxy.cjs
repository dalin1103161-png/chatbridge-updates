// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const {isIP}=require('node:net');
function timezone(value){try{if(typeof value!=='string'||value.length>100||!value.trim())throw Error();new Intl.DateTimeFormat('en',{timeZone:value});return value;}catch{throw Error('时区无效，请填写 IANA 时区，例如 America/New_York。');}}
function validate(value,previous,safeStorage){
 if(!value||typeof value.enabled!=='boolean')throw Error('代理设置无效。');
 if(!value.enabled)return {enabled:false};
 const host=String(value.host||'').trim(),port=Number(value.port),protocol=value.protocol;
 if(!/^(?:[a-zA-Z0-9.-]+|\[[a-fA-F0-9:]+\])$/.test(host)||host.length>253||!Number.isInteger(port)||port<1||port>65535||!['http','https','socks5'].includes(protocol))throw Error('请检查代理 IP、端口和协议。');
 if(typeof value.username!=='string'||typeof value.password!=='string'||value.username.length>512||value.password.length>2048||/[\r\n\0]/.test(value.username+value.password))throw Error('代理认证信息无效。');
 let password=value.password;
 if(!password&&value.keepPassword===true&&previous?.secret){try{password=JSON.parse(safeStorage.decryptString(Buffer.from(previous.secret,'base64'))).password;}catch{throw Error('无法解密旧密码，请重新填写。');}}
 if(protocol==='socks5'&&(value.username||password))throw Error('此版本的 SOCKS5 仅支持无密码代理；带账号密码请选择供应商的 HTTP/HTTPS 端口。');
 if((value.username||password)&&!safeStorage?.isEncryptionAvailable())throw Error('Windows 密码保护不可用，未保存密码。');
 if(typeof value.autoTimezone!=='boolean')throw Error('时区设置无效。');
 return {enabled:true,protocol,host,port,autoTimezone:value.autoTimezone,timezone:value.autoTimezone?(previous?.timezone||''):timezone(value.timezone),secret:value.username||password?safeStorage.encryptString(JSON.stringify({username:value.username,password})).toString('base64'):undefined};
}
function credentials(config,safeStorage){if(!config?.secret)return {username:'',password:''};try{return JSON.parse(safeStorage.decryptString(Buffer.from(config.secret,'base64')));}catch{throw Error('代理密码无法解密，请重新填写。');}}
function publicConfig(config,safeStorage){const c=config||{enabled:false};const auth=credentials(c,safeStorage);return {enabled:c.enabled===true,protocol:c.protocol||'http',host:c.host||'',port:c.port||'',username:auth.username,hasPassword:Boolean(auth.password),autoTimezone:c.autoTimezone!==false,timezone:c.timezone||''};}
function geoRequest(net,ses,url,config,auth){return new Promise((resolve,reject)=>{
 const req=net.request({url,session:ses,method:'GET',useSessionCookies:false,credentials:'include',cache:'no-store'});let settled=false;const finish=(error,result)=>{if(settled)return;settled=true;clearTimeout(timer);error?reject(error):resolve(result);};
 const timer=setTimeout(()=>{finish(Error('出口 IP 检测超时'));req.abort();},12000);
 req.on('login',(info,callback)=>{if(info.isProxy&&String(info.host).toLowerCase()===config.host.replace(/^\[|\]$/g,'').toLowerCase()&&Number(info.port)===config.port)callback(auth.username,auth.password);else callback();});
 req.on('redirect',()=>{finish(Error('IP 检测服务发生重定向'));req.abort();});
 req.on('error',()=>finish(Error('代理连接或认证失败')));
 req.on('response',res=>{if(res.statusCode!==200){finish(Error('IP 检测服务暂不可用'));req.abort();return;}let body='';res.on('data',data=>{body+=data.toString();if(body.length>65536){finish(Error('IP 检测响应无效'));req.abort();}});res.on('error',()=>finish(Error('IP 检测响应中断')));res.on('end',()=>{try{finish(null,JSON.parse(body));}catch{finish(Error('IP 检测响应无效'));}});});req.end();
 });}
function createProxyController(contents,{net,safeStorage,notify=()=>{},lookup}={}){
 const ses=contents.session;let phase='blocked',current,auth={},status={state:'idle'},closed=false;
 const update=value=>{status=value;notify({...status});};
 // A configured session stays blocked until routing and timezone are ready.
 ses.webRequest.onBeforeRequest((details,callback)=>{let allowed=phase==='ready';if(phase==='checking'){try{allowed=['https:'].includes(new URL(details.url).protocol)&&['ipwho.is','ipapi.co'].includes(new URL(details.url).hostname);}catch{}}callback({cancel:!allowed});});
 contents.on('login',(event,_details,info,callback)=>{if(!current?.enabled||!info.isProxy)return;event.preventDefault();if(String(info.host).toLowerCase()===current.host.replace(/^\[|\]$/g,'').toLowerCase()&&Number(info.port)===current.port)callback(auth.username,auth.password);else callback();});
 const detect=lookup|| (async config=>{let error;for(const url of ['https://ipwho.is/','https://ipapi.co/json/']){try{const value=await geoRequest(net,ses,url,config,auth);if(value.success===false||!isIP(value.ip))throw Error();const zone=timezone(typeof value.timezone==='string'?value.timezone:value.timezone?.id);return {ip:value.ip,timezone:zone};}catch(e){error=e;}}throw error||Error('无法检测出口 IP');});
 const block=()=>{phase='blocked';if(!contents.isDestroyed?.())contents.stop?.();};
 const fail=()=>{if(closed)return;block();update({state:'blocked',enabled:current?.enabled===true,message:'代理连接已暂停，请检查网络并重新检测。'});ses.closeAllConnections().catch(()=>{});};
 ses.webRequest.onErrorOccurred?.(details=>{if(current?.enabled&&/ERR_(PROXY_|TUNNEL_CONNECTION_FAILED|SOCKS_CONNECTION_)/.test(details.error||''))fail();});
 const configure=async config=>{
  block();current=config;update({state:'checking'});
  try{
   if(!ses.setProxy)throw Error('当前运行环境不支持代理');
   await contents.loadURL?.('about:blank');
   auth=credentials(config,safeStorage);await ses.closeAllConnections();await ses.clearAuthCache?.();
   await ses.setProxy(config?.enabled?{mode:'fixed_servers',proxyRules:config.protocol+'://'+config.host+':'+config.port,proxyBypassRules:'<-loopback>'}:{mode:'direct'});
   contents.setWebRTCIPHandlingPolicy?.(config?.enabled?'disable_non_proxied_udp':'default');
   let result={};if(config?.enabled){phase='checking';result=await detect(config);if(closed)throw Error();if(!config.autoTimezone)result.timezone=timezone(config.timezone);}
   const zone=result.timezone||'';if(!contents.debugger.isAttached())contents.debugger.attach('1.3');let timezoneTimer;try{await Promise.race([contents.debugger.sendCommand('Emulation.setTimezoneOverride',{timezoneId:zone}),new Promise((_,reject)=>{timezoneTimer=setTimeout(()=>reject(Error('时区初始化超时')),8000);})]);}finally{clearTimeout(timezoneTimer);}
   if(closed)throw Error();phase='ready';update({state:'ready',enabled:config?.enabled===true,...result});return {...status};
  }catch{block();update({state:'blocked',enabled:config?.enabled===true,message:'代理或出口时区检测失败，已暂停此账号连接。请检查协议、密码和代理状态后重试。'});throw Error(status.message);}
 };
 contents.debugger.on?.('detach',()=>{if(current?.enabled&&!closed&&!contents.isDestroyed?.()){block();update({state:'blocked',enabled:true,message:'时区设置已断开，请重新检测代理。'});ses.closeAllConnections().catch(()=>{});}});
 contents.once('destroyed',()=>{closed=true;phase='blocked';});
 return {configure,block,fail,state:()=>({...status})};
}
module.exports={timezone,validate,credentials,publicConfig,createProxyController,geoRequest};
