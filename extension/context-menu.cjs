// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
function bindContextMenu(contents,owner,Menu){
 if(!Menu)return;
 contents.on('context-menu',(_event,params)=>{
  const items=[];
  const safe=fn=>()=>{if(!contents.isDestroyed?.())fn();};
  if(params.mediaType==='image'&&params.hasImageContents&&Number.isInteger(params.x)&&Number.isInteger(params.y)){
   items.push({label:'复制图片 / Copy image',click:safe(()=>contents.copyImageAt(params.x,params.y))});
  }
  if(params.selectionText)items.push({label:'复制 / Copy',enabled:params.editFlags?.canCopy!==false,click:safe(()=>contents.copy())});
  if(params.isEditable){
   if(params.selectionText)items.push({label:'剪切 / Cut',enabled:params.editFlags?.canCut!==false,click:safe(()=>contents.cut())});
   items.push({label:'粘贴 / Paste',enabled:params.editFlags?.canPaste!==false,click:safe(()=>{contents.focus();contents.paste();})});
   items.push({label:'全选 / Select all',click:safe(()=>contents.selectAll())});
  }
  if(items.length)Menu.buildFromTemplate(items).popup({window:owner});
 });
}
module.exports={bindContextMenu};
