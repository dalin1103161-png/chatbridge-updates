// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const languages={US:'en-US',GB:'en-GB',CA:'en-CA',AU:'en-AU',NZ:'en-NZ',CN:'zh-CN',TW:'zh-TW',HK:'zh-HK',JP:'ja-JP',KR:'ko-KR',DE:'de-DE',FR:'fr-FR',IT:'it-IT',ES:'es-ES',BR:'pt-BR',PT:'pt-PT',TH:'th-TH',VN:'vi-VN',ID:'id-ID',MX:'es-MX',PL:'pl-PL',NL:'nl-NL',SG:'en-SG',IN:'en-IN',PH:'en-PH',MY:'ms-MY',CH:'de-CH',AT:'de-AT',AR:'es-AR',CO:'es-CO',ZA:'en-ZA'};
function resolve(profile,network,system){
 const language=profile.languageMode==='manual'?profile.language:profile.languageMode==='ip'?(languages[network.country]||profile.language):system;
 const geo=profile.geoMode==='manual'?{latitude:profile.latitude,longitude:profile.longitude,accuracy:profile.accuracy}:profile.geoMode==='ip'&&Number.isFinite(network.latitude)&&Number.isFinite(network.longitude)?{latitude:network.latitude,longitude:network.longitude,accuracy:50000}:null;
 if(profile.geoMode==='ip'&&!geo)throw Error('出口定位服务未提供坐标，请切换手动位置或关闭位置。');
 return {language,timezone:network.timezone||'',geo,languageFallback:profile.languageMode==='ip'&&!languages[network.country]};
}
const bootstrapURL='https://chatbridge-profile.invalid/';
const metadataScript=`(async()=>{const u=navigator.userAgentData;if(!u)return null;const v=await u.getHighEntropyValues(['architecture','bitness','model','platformVersion','uaFullVersion','fullVersionList','wow64']);return {brands:v.brands||u.brands,fullVersionList:v.fullVersionList,fullVersion:v.uaFullVersion,platform:v.platform||u.platform,platformVersion:v.platformVersion||'',architecture:v.architecture||'',model:v.model||'',mobile:Boolean(v.mobile??u.mobile),bitness:v.bitness,wow64:v.wow64};})()`;
async function nativeMetadata(contents){
 let value=await contents.executeJavaScript(metadataScript);if(value)return value;
 // Serve a trusted HTTPS document entirely inside this debugger session. No external navigation is needed.
 const dbg=contents.debugger;let rejectRequest,timer;const failed=new Promise((_,reject)=>rejectRequest=reject);failed.catch(()=>{});
 const intercept=(_e,method,params)=>{if(method!=='Fetch.requestPaused')return;if(params.request.url!==bootstrapURL){dbg.sendCommand('Fetch.failRequest',{requestId:params.requestId,errorReason:'BlockedByClient'}).catch(()=>{});return;}dbg.sendCommand('Fetch.fulfillRequest',{requestId:params.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/html'},{name:'Cache-Control',value:'no-store'}],body:Buffer.from('<!doctype html><title>Local profile setup</title>').toString('base64')}).catch(rejectRequest);};
 dbg.on('message',intercept);try{
  await dbg.sendCommand('Fetch.enable',{patterns:[{urlPattern:bootstrapURL+'*',requestStage:'Request'}]});
  await Promise.race([contents.loadURL(bootstrapURL),failed,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('浏览器语言初始化超时。')),5000);})]);
  value=await contents.executeJavaScript(metadataScript);if(!value||!Array.isArray(value.brands)||typeof value.platform!=='string')throw Error('当前内核未提供可验证的浏览器标识。');return value;
 }catch(error){contents.stop?.();throw error;}finally{clearTimeout(timer);dbg.removeListener('message',intercept);await dbg.sendCommand('Fetch.disable').catch(()=>{});}
}
async function apply(contents,effective,proxyEnabled,{languageOverride=false,userAgent}={}){
 const dbg=contents.debugger;if(!dbg.isAttached())dbg.attach('1.3');
 const commands=[['Emulation.setTimezoneOverride',{timezoneId:effective.timezone}],['Emulation.setLocaleOverride',{locale:effective.language.replaceAll('-','_')}],effective.geo?['Emulation.setGeolocationOverride',effective.geo]:['Emulation.clearGeolocationOverride',{}]];
 let timer;try{await Promise.race([(async()=>{if(languageOverride){const userAgentMetadata=await nativeMetadata(contents),language=effective.language;await dbg.sendCommand('Emulation.setUserAgentOverride',{userAgent,acceptLanguage:language.includes('-')?language+','+language.split('-')[0]:language,userAgentMetadata});}for(const [method,args]of commands)await dbg.sendCommand(method,args);})(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('浏览器环境初始化超时。')),12000);})]);}finally{clearTimeout(timer);}
 contents.setWebRTCIPHandlingPolicy?.(proxyEnabled?'disable_non_proxied_udp':'default');
}
const inspectScript=`(()=>({userAgent:navigator.userAgent,languages:Array.from(navigator.languages||[]),locale:Intl.DateTimeFormat().resolvedOptions().locale,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,platform:navigator.platform,cores:navigator.hardwareConcurrency,screen:{width:screen.width,height:screen.height,dpr:devicePixelRatio}}))()`;
module.exports={resolve,apply,inspectScript};
