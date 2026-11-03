// SPDX-License-Identifier: AGPL-3.0-only
// Local synthetic authenticated proxy fixture; no real credentials or accounts.
module.exports=async function(electron){
 const {BrowserWindow,session,net}=electron,http=require('node:http'),assert=require('node:assert/strict');const {createProxyController,geoRequest}=require('../extension/proxy.cjs');
 const server=http.createServer((req,res)=>{if(req.headers['proxy-authorization']!=='Basic '+Buffer.from('fixture:secret').toString('base64')){res.writeHead(407,{'Proxy-Authenticate':'Basic realm="fixture"'});res.end();return;}res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({ip:'203.0.113.7',timezone:'America/New_York'}));});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const port=server.address().port,ses=session.fromPartition('proxy-test-'+Date.now());let w;try{
 w=new BrowserWindow({show:false,webPreferences:{session:ses}});const config={enabled:true,protocol:'http',host:'127.0.0.1',port,autoTimezone:true};const controller=createProxyController(w.webContents,{net,lookup:async()=>({ip:'203.0.113.7',timezone:'America/New_York'})});console.log('PROXY_CONFIG_START');await controller.configure(config);console.log('PROXY_CONFIG_READY');
 assert((await ses.resolveProxy('https://web.whatsapp.com')).includes('127.0.0.1:'+port));
 console.log('PROXY_ROUTE_RESOLVED');const result=await geoRequest(net,ses,'http://proxy-fixture.invalid/',config,{username:'fixture',password:'secret'});assert.equal(result.ip,'203.0.113.7');console.log('AUTHENTICATED_PROXY_REQUEST_PASS');
 console.log('PROXY_BEFORE_TIMEZONE_PAGE');await w.loadURL('data:text/html,<body>Timezone fixture</body>');console.log('PROXY_TIMEZONE_PAGE_LOADED');assert.equal(await w.webContents.executeJavaScript('Intl.DateTimeFormat().resolvedOptions().timeZone'),'America/New_York');console.log('ISOLATED_IP_TIMEZONE_PASS');
 const other=new BrowserWindow({show:false});try{await other.loadURL('data:text/html,<body>Other session</body>');assert(!(await other.webContents.session.resolveProxy('https://web.whatsapp.com')).includes('127.0.0.1:'+port));}finally{other.destroy();}
 controller.block();await assert.rejects(geoRequest(net,ses,'http://proxy-fixture.invalid/',config,{username:'fixture',password:'secret'}));console.log('BLOCKED_PROXY_NO_NETWORK_FALLBACK_PASS');
 }finally{w?.destroy();server.closeAllConnections();await new Promise(r=>server.close(r));}
};
