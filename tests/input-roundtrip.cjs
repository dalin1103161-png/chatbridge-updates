// SPDX-License-Identifier: AGPL-3.0-only
// Windows OS keyboard test in an isolated local input, never a linked chat.
const {spawn}=require('node:child_process');
const {clipboard}=require('electron');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
module.exports=async function inputRoundtrip(w){
 const wc=w.webContents;
 await wc.executeJavaScript(`(()=>{const box=document.createElement('textarea');box.id='cb-test-input';box.style.cssText='position:fixed;left:30px;top:160px;width:320px;height:100px;z-index:2147483647';document.body.append(box);box.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();box.dataset.sent=box.value;}});box.focus();})()`);
 wc.focus();await delay(150);
 const key=keys=>new Promise((resolve,reject)=>{const p=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',"Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('"+keys+"')"],{windowsHide:true,stdio:'ignore'});p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(Error('OS keyboard injection failed')));});
 const wait=async(expression,expected)=>{const until=Date.now()+5000;while(await wc.executeJavaScript(expression)!==expected){if(Date.now()>until)throw Error('Keyboard roundtrip failed: '+expression);await delay(50);}};
 await key('bridge');await wait("document.querySelector('#cb-test-input').value",'bridge');
 await key('^a');await key('^c');const until=Date.now()+5000;while(clipboard.readText()!=='bridge'){if(Date.now()>until)throw Error('Ctrl+C did not copy the active embedded input');await delay(50);}
 clipboard.writeText('paste fixture');await key('^v');await wait("document.querySelector('#cb-test-input').value",'paste fixture');
 await key('{ENTER}');await wait("document.querySelector('#cb-test-input').dataset.sent",'paste fixture');
 await wc.executeJavaScript("document.querySelector('#cb-test-input').remove()");
};
