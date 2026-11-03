// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const languages={US:'en-US',GB:'en-GB',CA:'en-CA',AU:'en-AU',NZ:'en-NZ',CN:'zh-CN',TW:'zh-TW',HK:'zh-HK',JP:'ja-JP',KR:'ko-KR',DE:'de-DE',FR:'fr-FR',IT:'it-IT',ES:'es-ES',BR:'pt-BR',PT:'pt-PT',TH:'th-TH',VN:'vi-VN',ID:'id-ID',MX:'es-MX',PL:'pl-PL',NL:'nl-NL',SG:'en-SG',IN:'en-IN',PH:'en-PH',MY:'ms-MY',CH:'de-CH',AT:'de-AT',AR:'es-AR',CO:'es-CO',ZA:'en-ZA'};
function resolve(profile,network,system){
 const language=profile.languageMode==='manual'?profile.language:profile.languageMode==='ip'?(languages[network.country]||profile.language):system;
 const geo=profile.geoMode==='manual'?{latitude:profile.latitude,longitude:profile.longitude,accuracy:profile.accuracy}:profile.geoMode==='ip'&&Number.isFinite(network.latitude)&&Number.isFinite(network.longitude)?{latitude:network.latitude,longitude:network.longitude,accuracy:50000}:null;
 if(profile.geoMode==='ip'&&!geo)throw Error('出口定位服务未提供坐标，请切换手动位置或关闭位置。');
 return {language,timezone:network.timezone||'',geo,languageFallback:profile.languageMode==='ip'&&!languages[network.country]};
}
async function apply(contents,effective,proxyEnabled){
 const dbg=contents.debugger;if(!dbg.isAttached())dbg.attach('1.3');
 const commands=[['Emulation.setTimezoneOverride',{timezoneId:effective.timezone}],['Emulation.setLocaleOverride',{locale:effective.language.replaceAll('-','_')}],effective.geo?['Emulation.setGeolocationOverride',effective.geo]:['Emulation.clearGeolocationOverride',{}]];
 let timer;try{await Promise.race([(async()=>{for(const [method,args]of commands)await dbg.sendCommand(method,args);})(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('浏览器环境初始化超时。')),8000);})]);}finally{clearTimeout(timer);}
 contents.setWebRTCIPHandlingPolicy?.(proxyEnabled?'disable_non_proxied_udp':'default');
}
const inspectScript=`(()=>({userAgent:navigator.userAgent,languages:Array.from(navigator.languages||[]),locale:Intl.DateTimeFormat().resolvedOptions().locale,timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,platform:navigator.platform,cores:navigator.hardwareConcurrency,screen:{width:screen.width,height:screen.height,dpr:devicePixelRatio}}))()`;
module.exports={resolve,apply,inspectScript};
