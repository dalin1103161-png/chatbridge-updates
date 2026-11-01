// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const validCount=count=>Number.isSafeInteger(count)&&count>=0;
function titleUnread(title){
 if(typeof title!=='string')return null;
 const normalized=title.replace(/^[\s\u200e\u200f]+/,'');
 const match=/^[（(]\s*([\d,\u00a0 ]+)\s*[)）]\s*WhatsApp\b/i.exec(normalized);
 if(match){const n=Number(match[1].replace(/[,\s\u00a0]/g,''));return validCount(n)?n:null;}
 return /^WhatsApp\b/i.test(normalized)?0:null;
}
function createUnreadState(notify){
 const entries=new Map();let revision=0;
 return {
  update(platform,id,count){if(!['signal','whatsapp'].includes(platform)||typeof id!=='string'||!validCount(count))return false;const key=platform+':'+id;if(entries.get(key)?.count===count)return false;const entry={platform,id,count,revision:++revision};entries.set(key,entry);notify({...entry});return true;},
  snapshot:()=>[...entries.values()].map(e=>({...e})),
  remove(platform,id){const key=platform+':'+id;if(entries.has(key)){this.update(platform,id,0);entries.delete(key);}}
 };
}
function bindSignalUnread(contents,ipcMain,publish){
 let priority=-1,last;
 const report=(event,count,source)=>{if(event.sender?.id!==contents.id||!validCount(count)||source<priority)return;priority=source;if(count!==last){last=count;publish(count);}};
 const badge=(event,count)=>report(event,count,0),tray=(event,count)=>report(event,count,1),raw=(event,count)=>report(event,count,2);
 ipcMain.on('set-badge-count',badge);ipcMain.on('update-tray-icon',tray);ipcMain.on('chatbridge:signal-unread',raw);
 contents.once('destroyed',()=>{ipcMain.removeListener('set-badge-count',badge);ipcMain.removeListener('update-tray-icon',tray);ipcMain.removeListener('chatbridge:signal-unread',raw);});
}
module.exports={validCount,titleUnread,createUnreadState,bindSignalUnread};
