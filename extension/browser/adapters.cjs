// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
function siteURL(value){try{if(typeof value!=='string'||value.length>8192)throw Error();const url=new URL(value.trim());if(!['http:','https:'].includes(url.protocol)||url.username||url.password)throw Error();return url.href;}catch{throw Error('请输入有效的 HTTP 或 HTTPS 网站地址。');}}
const website={label:'自定义网站',url:siteURL,preferences:()=>({})};
const whatsapp={label:'WhatsApp',url(value){const u=new URL(siteURL(value||'https://web.whatsapp.com/'));if(u.origin!=='https://web.whatsapp.com')throw Error('WhatsApp 只允许官方 Web 地址。');return u.href;},preferences(root){return {preload:require('node:path').join(root,'chatbridge','preload.cjs'),additionalArguments:['--chatbridge-whatsapp']};}};
module.exports=Object.freeze({website:Object.freeze(website),whatsapp:Object.freeze(whatsapp)});
