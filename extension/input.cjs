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
 contents.on('before-mouse-event',(_event,input)=>{
  if(input.type==='mouseDown')contents.focus();
 });
}
module.exports={bindInput,edit};
