// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const MIN=50,MAX=200,STEP=10;
function zoomState(saved,value){
 let percent=Number.isInteger(saved)&&saved>=MIN&&saved<=MAX?saved:100;
 if(value!==undefined){
  if(!value||!['in','out','reset'].includes(value.action))throw Error('缩放设置无效。');
  percent=value.action==='reset'?100:Math.min(MAX,Math.max(MIN,percent+(value.action==='in'?STEP:-STEP)));
 }
 return {percent,min:MIN,max:MAX};
}
function bindZoom(contents,request,{keepScale=false}={}){
 // Recent Electron versions support isolated zoom; separate account partitions
 // and Signal profile processes also keep legacy per-origin zoom independent.
 contents.setZoomMode?.('isolated');
 let serial=Promise.resolve(),expectedFactor;
 const reconcile=()=>{if(expectedFactor!==undefined&&!contents.isDestroyed?.()&&contents.getZoomFactor&&Math.abs(contents.getZoomFactor()-expectedFactor)>0.001)contents.setZoomFactor(expectedFactor);};
 if(keepScale){const timer=setInterval(reconcile,500);timer.unref?.();contents.once('destroyed',()=>clearInterval(timer));}
 const apply=value=>{
  const job=serial.then(()=>request(value)).then(state=>{
   if(!contents.isDestroyed?.()){expectedFactor=state.percent/100;contents.setZoomFactor(expectedFactor);contents.send('chatbridge:zoom',state);}
   return state;
  });serial=job.catch(()=>{});return job;
 };
 const report=()=>{if(!contents.isDestroyed?.())contents.send('chatbridge:zoom-error','聊天缩放失败，请重试。');};
 contents.on('did-finish-load',()=>apply().catch(report));
 contents.on('before-input-event',(event,input)=>{
  if(input.type!=='keyDown'||!input.control||input.alt)return;
  const action=['+','=','Add'].includes(input.key)?'in':['-','_','Subtract'].includes(input.key)?'out':input.key==='0'?'reset':null;
  if(action){event.preventDefault();apply({action}).catch(report);}
 });
 contents.on('zoom-changed',(_event,direction)=>{if(['in','out'].includes(direction))apply({action:direction}).catch(report);});
 return apply;
}
module.exports={zoomState,bindZoom};
