// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const commands=new Set(['copy','paste','pasteAndMatchStyle','cut','selectAll','undo','redo']);
function edit(contents,command){
 if(!commands.has(command))throw Error('不支持的编辑操作。');
 if(contents.isDestroyed?.())throw Error('聊天窗口已关闭。');
 contents[command]();return true;
}
function bindInput(contents){
 // The host menu belongs to another BrowserWindow; let the actual page own its keys.
 contents.setIgnoreMenuShortcuts?.(true);
 contents.on('before-input-event',(event,input)=>{
  if(input.type!=='keyDown'||(!input.control&&!input.meta)||input.alt||input.isComposing)return;
  const key=input.key.toLowerCase();
  const command=input.shift?(key==='v'?'pasteAndMatchStyle':key==='z'?'redo':null):({c:'copy',v:'paste',x:'cut',a:'selectAll',z:'undo',y:'redo'}[key]);
  if(!command)return;
  event.preventDefault();edit(contents,command);
 });

 contents.on('before-mouse-event',(_event,input)=>{
  if(input.type==='mouseDown')contents.focus();
 });
}
module.exports={bindInput,edit};
