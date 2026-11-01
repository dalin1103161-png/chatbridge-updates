// SPDX-License-Identifier: AGPL-3.0-only
// Windows OS keyboard test in isolated local controls, never a linked chat.
const {spawn}=require('node:child_process');
const {clipboard}=require('electron');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
module.exports=async function inputRoundtrip(w){
 const wc=w.webContents;
 const key=keys=>new Promise((resolve,reject)=>{const p=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',"Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('"+keys+"')"],{windowsHide:true,stdio:'ignore'});p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(Error('OS keyboard injection failed')));});
 const wait=async(expression,expected)=>{const until=Date.now()+5000;while(await wc.executeJavaScript(expression)!==expected){if(Date.now()>until)throw Error('Keyboard roundtrip failed: '+expression);await delay(50);}};
 for(const tag of ['textarea','div']){
  await clipboard.writeText('clipboard baseline');if(await clipboard.readText()!=='clipboard baseline')throw Error('Test clipboard unavailable');
  await wc.executeJavaScript(`(()=>{const box=document.createElement('${tag}');box.id='cb-test-input';if('${tag}'==='div')box.contentEditable='true';box.style.cssText='position:fixed;left:30px;top:160px;width:320px;height:100px;z-index:2147483647;background:white;color:black';document.body.append(box);box.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();box.dataset.sent='${tag}'==='textarea'?box.value:box.textContent;}});box.focus();})()`);
  wc.focus();await delay(150);
  const text=tag==='textarea'?"document.querySelector('#cb-test-input').value":"document.querySelector('#cb-test-input').textContent";
  await key('bridge');await wait(text,'bridge');
  await key('^a');await key('^c');const until=Date.now()+5000;while(await clipboard.readText()!=='bridge'){if(Date.now()>until)throw Error('Ctrl+C did not copy the active '+tag);await delay(50);}
  await clipboard.writeText('paste fixture');await key('^v');await wait(text,'paste fixture');
  await key('{ENTER}');await wait("document.querySelector('#cb-test-input').dataset.sent",'paste fixture');
  await wc.executeJavaScript("document.querySelector('#cb-test-input').remove()");
 }
};
