// SPDX-License-Identifier: AGPL-3.0-only
// Windows OS keyboard test in isolated local controls, never a linked chat.
const {spawn}=require('node:child_process');
const {clipboard}=require('electron');
const delay=ms=>new Promise(r=>setTimeout(r,ms));
module.exports=async function inputRoundtrip(w,options={}){
 const wc=w.webContents;const events=[];wc.on('before-input-event',(_e,input)=>events.push({key:input.key,ctrl:input.control}));
 const key=keys=>new Promise((resolve,reject)=>{const p=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',"Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait('"+keys+"')"],{windowsHide:true,stdio:'ignore'});p.on('error',reject);p.on('exit',code=>code===0?resolve():reject(Error('OS keyboard injection failed')));});
 const wait=async(expression,expected)=>{const until=Date.now()+5000;while(await wc.executeJavaScript(expression)!==expected){if(Date.now()>until)throw Error('Keyboard roundtrip failed: '+expression+' '+JSON.stringify({events,webFocus:wc.isFocused(),dom:await wc.executeJavaScript("JSON.stringify({focus:document.hasFocus(),active:document.activeElement?.id,value:document.querySelector('#cb-test-input')?.value})")}));await delay(50);}};
 for(const tag of ['textarea','div']){
  await clipboard.writeText('clipboard baseline');if(await clipboard.readText()!=='clipboard baseline')throw Error('Test clipboard unavailable');
  await wc.executeJavaScript(`(()=>{const box=document.createElement('${tag}');box.id='cb-test-input';if('${tag}'==='div')box.contentEditable='true';box.style.cssText='position:fixed;left:30px;top:160px;width:320px;height:100px;z-index:2147483647;background:white;color:black';document.body.append(box);box.addEventListener('keydown',e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();box.dataset.sent='${tag}'==='textarea'?box.value:box.textContent;}});if(!${Boolean(options.mouse)})box.focus();})()`);
  if(options.mouse&&w.getNativeWindowHandle){
   const buffer=w.getNativeWindowHandle(),handle=(buffer.length===8?buffer.readBigUInt64LE():BigInt(buffer.readUInt32LE())).toString();
   const point=await wc.executeJavaScript(`(()=>{const r=document.querySelector('#cb-test-input').getBoundingClientRect();return {x:Math.round((r.left+20)*devicePixelRatio),y:Math.round((r.top+20)*devicePixelRatio)};})()`);
   const script=`Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;public static class ClickTest { [StructLayout(LayoutKind.Sequential)] public struct POINT {public int x,y;} [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h,ref POINT p);[DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);[DllImport("user32.dll")] public static extern void mouse_event(uint f,uint x,uint y,uint d,UIntPtr extra);public static void Click(long h,int x,int y){var p=new POINT{x=x,y=y};ClientToScreen(new IntPtr(h),ref p);SetCursorPos(p.x,p.y);mouse_event(2,0,0,0,UIntPtr.Zero);mouse_event(4,0,0,0,UIntPtr.Zero);}}
'@;[ClickTest]::Click(${handle},${point.x},${point.y})`;

   await new Promise((resolve,reject)=>{const proc=spawn('powershell.exe',['-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,stdio:'ignore'});proc.on('error',reject);proc.on('exit',code=>code===0?resolve():reject(Error('OS mouse click failed')));});
  } else if(options.focus!==false)wc.focus();await delay(30);
  const text=tag==='textarea'?"document.querySelector('#cb-test-input').value":"document.querySelector('#cb-test-input').textContent";
  await key('bridge');await wait(text,'bridge');
  await key('^a');await key('^c');const until=Date.now()+5000;while(await clipboard.readText()!=='bridge'){if(Date.now()>until)throw Error('Ctrl+C did not copy the active '+tag);await delay(50);}
  await clipboard.writeText('paste fixture');await key('^v');await wait(text,'paste fixture');
  if(tag==='div'){for(let attempt=0;attempt<3;attempt++){const textValue='repeat paste '+attempt;await clipboard.writeText(textValue);await key('^a');await key('^v');await wait(text,textValue);}await clipboard.writeText('paste fixture');await key('^a');await key('^v');await wait(text,'paste fixture');}
  await key('{ENTER}');await wait("document.querySelector('#cb-test-input').dataset.sent",'paste fixture');
  await wc.executeJavaScript("document.querySelector('#cb-test-input').remove()");
 }
};
