// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{JSDOM}=require('jsdom');
const {installPreload}=require('../extension/preload.cjs');
function fixture(whatsapp=false,html,translation,signalContent=false){
 const dom=new JSDOM(html||'<!doctype html><body><div class="module-ConversationHeader__header__info__title">Friend</div><div data-message-id="old"><span class="module-message__text">Hello from history</span></div></body>',{url:'https://fixture.invalid'});
 const old={document:global.document,interval:global.setInterval,installed:global.__chatbridgeInstalled};global.document=dom.window.document;global.setInterval=()=>1;delete global.__chatbridgeInstalled;
 let percent=100;const calls=[];const ipc={invoke:async(_channel,method,value)=>{
  calls.push({method,value});
  if(method==='chat-zoom'){if(value)percent=value.action==='reset'?100:Math.max(50,Math.min(200,percent+(value.action==='in'?10:-10)));return {percent,min:50,max:200};}
  if(method==='accounts')return [{id:'wa-one',name:'Work WA'},{id:'wa-two',name:'Personal WA'}];
  if(method==='signal-accounts')return {accounts:[{id:'default',name:'Signal Work'}],current:'default'};
  if(method==='add-whatsapp')return {id:'test-account',name:value};
  if(method==='translate')return translation?translation(value):'<b>译文作为纯文字</b>';
  return true;
 }};
 const api=installPreload({ipc,whatsapp,signalContent});dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
 return {dom,api,calls,async close(){await api.state.serial;global.document=old.document;global.setInterval=old.interval;global.__chatbridgeInstalled=old.installed;dom.window.close();}};
}
const requests=f=>f.calls.filter(x=>x.method==='translate');
test('opening a chat automatically translates loaded text without switches or clicks',async()=>{
 const f=fixture();try{
  await f.api.state.serial;const d=f.dom.window.document,output=d.querySelector('[data-chatbridge-output]');
  assert.equal(requests(f).length,1);assert.equal(output.textContent,'<b>译文作为纯文字</b>');assert.equal(output.querySelector('b'),null);
  assert.equal(output.parentElement.previousElementSibling.textContent,'Hello from history');
  assert.equal(d.querySelectorAll('[data-chatbridge-bar] input[type="checkbox"]').length,0);
  assert(!d.querySelector('[data-chatbridge-bar]').textContent.includes('历史翻译'));assert(!d.querySelector('[data-chatbridge-bar]').textContent.includes('新消息翻译'));
  assert(d.querySelector('[data-chatbridge-bar]').textContent.includes('自动翻译已开启'));
  assert.equal(d.querySelector('[data-chatbridge-message] button').hidden,true);
 }finally{await f.close();}
});
test('new and newly loaded historical messages translate automatically without retranslating old rows',async()=>{
 const f=fixture();try{
  await f.api.state.serial;const d=f.dom.window.document;
  for(const [id,text] of [['new','New message'],['earlier','Earlier loaded history']]){
   const n=d.createElement('div');n.dataset.messageId=id;const s=d.createElement('span');s.className='module-message__text';s.textContent=text;n.append(s);d.body.append(n);
   f.api.scan();await f.api.state.serial;
  }
  f.api.scan();await f.api.state.serial;
  assert.deepEqual(requests(f).map(x=>x.value.text),['Hello from history','New message','Earlier loaded history']);
 }finally{await f.close();}
});
test('switching conversations keeps automatic translation active',async()=>{
 const f=fixture();try{
  await f.api.state.serial;const d=f.dom.window.document;
  for(const name of ['Second friend','Third friend']){
   d.querySelector('.module-ConversationHeader__header__info__title').textContent=name;
   d.querySelector('.module-message__text').textContent='Message for '+name;f.api.scan();await f.api.state.serial;
   assert.equal(d.querySelector('[data-chatbridge-output]').textContent,'<b>译文作为纯文字</b>');
  }
  assert.equal(requests(f).length,3);
 }finally{await f.close();}
});
test('translation language changes automatically refresh the translation',async()=>{
 const f=fixture(false,undefined,v=>v.target+':'+v.text);try{
  await f.api.state.serial;const d=f.dom.window.document,target=d.querySelector('[aria-label="译文语言 / Translation language"]');target.value='en';target.onchange();await f.api.state.serial;
  assert.equal(d.querySelector('[data-chatbridge-output]').textContent,'en:Hello from history');assert.equal(requests(f).length,2);
 }finally{await f.close();}
});
test('failed automatic translation offers one retry and never loops by itself',async()=>{
 let count=0;const f=fixture(false,undefined,()=>{if(++count===1)throw Error("Error invoking remote method 'chatbridge:invoke': Error: Expected failure");return '重试成功';});try{
  await f.api.state.serial;const d=f.dom.window.document,button=d.querySelector('[data-chatbridge-message] button');assert.equal(button.hidden,false);assert.equal(button.textContent,'重试翻译');
  assert.equal(d.querySelector('[data-chatbridge-output]').textContent,'Expected failure');f.api.scan();await f.api.state.serial;assert.equal(count,1);
  button.click();await f.api.state.serial;assert.equal(d.querySelector('[data-chatbridge-output]').textContent,'重试成功');assert.equal(button.hidden,true);
 }finally{await f.close();}
});
test('unchanged-language output does not duplicate the original message',async()=>{
 const f=fixture(false,undefined,v=>v.text);try{await f.api.state.serial;assert.equal(f.dom.window.document.querySelector('[data-chatbridge-output]').textContent,'');f.api.scan();await f.api.state.serial;assert.equal(requests(f).length,1);}finally{await f.close();}
});
test('multiple loaded messages are submitted together before the first result completes',async()=>{
 let release;const held=new Promise(r=>release=r);const f=fixture(false,'<!doctype html><body><div class="module-ConversationHeader__header__info__title">Friend</div>'+[1,2,3].map(i=>`<div data-message-id="${i}"><span class="module-message__text">Message ${i}</span></div>`).join('')+'</body>',()=>held);
 try{await Promise.resolve();assert.equal(requests(f).length,3);release('译文');await f.api.state.serial;assert.equal(f.dom.window.document.querySelectorAll('[data-translated="1"]').length,3);}finally{release('译文');await f.close();}
});
test('switching chats drops unstarted requests from the previous conversation',async()=>{
 let release;const held=new Promise(r=>release=r);const f=fixture(false,'<!doctype html><body><div class="module-ConversationHeader__header__info__title">First</div>'+Array.from({length:10},(_,i)=>`<div data-message-id="old${i}"><span class="module-message__text">Old ${i}</span></div>`).join('')+'</body>',v=>v.text.startsWith('Old')?held:'新聊天译文');
 try{await Promise.resolve();assert.equal(requests(f).length,8);f.dom.window.document.body.innerHTML='<div class="module-ConversationHeader__header__info__title">Second</div><div data-message-id="new"><span class="module-message__text">New chat</span></div>';f.api.scan();release('旧译文');await f.api.state.serial;assert.equal(requests(f).length,9);assert.equal(f.dom.window.document.querySelector('[data-chatbridge-output]').textContent,'新聊天译文');}finally{release('旧译文');await f.close();}
});
test('WhatsApp translations appear automatically inside the original bubble, below text',async()=>{
 const f=fixture(true,'<!doctype html><body><div id="app"><div id="main"><div data-id="false_friend_message"><div class="bubble"><div data-pre-plain-text="Friend"><span class="selectable-text">Honey. What problem are you encountering?</span></div></div></div></div></div></body>');try{
  await f.api.state.serial;const d=f.dom.window.document,box=d.querySelector('[data-chatbridge-message]');assert.equal(box.parentElement.getAttribute('data-pre-plain-text'),'Friend');assert.equal(box.previousElementSibling.textContent,'Honey. What problem are you encountering?');assert.equal(box.querySelector('[data-chatbridge-output]').textContent,'<b>译文作为纯文字</b>');f.api.scan();assert.equal(f.api.messageRows().rows[0].text,'Honey. What problem are you encountering?');assert.equal(requests(f).length,1);
 }finally{await f.close();}
});
test('WhatsApp selectable text can itself carry the message metadata',async()=>{
 const f=fixture(true,'<!doctype html><body><div id="app"><div id="main"><div data-id="false_friend_1"><div data-pre-plain-text="Friend" class="selectable-text">Current WhatsApp message</div></div></div></div></body>');try{await f.api.state.serial;assert.equal(f.api.messageRows().rows[0].text,'Current WhatsApp message');assert.equal(f.dom.window.document.querySelector('[data-chatbridge-output]').textContent,'<b>译文作为纯文字</b>');}finally{await f.close();}
});
test('adding WhatsApp uses a visible form and default name; blank input never calls IPC',async()=>{
 const f=fixture();try{const d=f.dom.window.document,add=[...d.querySelectorAll('button')].find(b=>b.textContent==='＋ 添加 WhatsApp');await add.onclick();await add.onclick();assert.equal(d.querySelectorAll('[data-chatbridge-add-account]').length,1);const form=d.querySelector('[data-chatbridge-add-account]'),input=form.querySelector('input'),save=form.querySelector('button');assert.equal(input.value,'WhatsApp 3');input.value=' ';await save.onclick();assert.equal(f.calls.filter(c=>c.method==='add-whatsapp').length,0);input.value=' Work ';await save.onclick();assert.equal(f.calls.find(c=>c.method==='add-whatsapp').value,'Work');assert.equal(d.querySelector('[data-chatbridge-add-account]'),null);}finally{await f.close();}
});
test('each account appears separately in the sidebar',async()=>{
 const f=fixture();try{await new Promise(r=>setImmediate(r));const d=f.dom.window.document;assert.equal(d.querySelectorAll('[data-cb-account]').length,3);assert.equal(d.querySelector('[aria-label="WhatsApp accounts"]'),null);await d.querySelector('[data-cb-account="whatsapp:wa-two"] button').onclick();assert(f.calls.some(c=>c.method==='whatsapp'&&c.value==='wa-two'));}finally{await f.close();}
});
test('home entry and welcome cards open the correct account flow',async()=>{
 const f=fixture(false,'<!doctype html><body><main data-chatbridge-home><button id="cb-home-whatsapp">WhatsApp</button><button id="cb-home-signal">Signal</button></main></body>');try{const d=f.dom.window.document;await d.querySelector('[data-cb-home-button]').onclick();assert(f.calls.some(c=>c.method==='home'));d.querySelector('#cb-home-whatsapp').click();await new Promise(r=>setTimeout(r,0));assert(d.querySelector('[data-chatbridge-add-account]'));}finally{await f.close();}
});


test('sidebar drag clamps width, saves on release and supports reset and keyboard controls',async()=>{
 const f=fixture();try{await f.api.state.serial;const d=f.dom.window.document,resize=d.querySelector('[data-cb-resizer]');assert(resize);assert.equal(resize.getAttribute('aria-valuenow'),'144');
  resize.onpointerdown({button:0,pointerId:1,clientX:144,preventDefault(){}});resize.onpointermove({clientX:104});resize.onpointerup();
  assert.equal(d.documentElement.style.getPropertyValue('--cb-sidebar-width'),'104px');assert(f.calls.some(c=>c.method==='sidebar-width'&&c.value?.width===104&&c.value.persist===true));
  resize.onkeydown({key:'Home',preventDefault(){}});assert.equal(resize.getAttribute('aria-valuenow'),'88');resize.onkeydown({key:'End',preventDefault(){}});assert.equal(resize.getAttribute('aria-valuenow'),'320');resize.ondblclick();assert.equal(resize.getAttribute('aria-valuenow'),'144');
 }finally{await f.close();}
});


test('chat toolbar zoom controls show percent and support enlarge, shrink and reset',async()=>{
 const f=fixture(false,undefined,undefined,true);try{await f.api.state.serial;await new Promise(r=>setImmediate(r));const d=f.dom.window.document,reset=d.querySelector('[data-cb-zoom-reset]');assert(reset);assert.equal(reset.textContent,'100%');await d.querySelector('[data-cb-zoom-in]').onclick();assert.equal(reset.textContent,'110%');await d.querySelector('[data-cb-zoom-out]').onclick();assert.equal(reset.textContent,'100%');await d.querySelector('[data-cb-zoom-in]').onclick();await reset.onclick();assert.equal(reset.textContent,'100%');assert.equal(d.querySelectorAll('[data-chatbridge-bar] input[type=checkbox]').length,0);}finally{await f.close();}
});

test('synthetic page shortcuts cannot access clipboard and ordinary typing remains native',async()=>{
 const f=fixture(true);try{
  const d=f.dom.window.document;
  for(const [key,extra,command] of [['c',{},'copy'],['v',{},'paste'],['v',{shiftKey:true},'pasteAndMatchStyle'],['a',{},'selectAll']]){
   const e=new f.dom.window.KeyboardEvent('keydown',{key,ctrlKey:true,bubbles:true,cancelable:true,...extra});const before=f.calls.length;d.dispatchEvent(e);assert(!e.defaultPrevented);assert.equal(f.calls.length,before);
  }
  for(const values of [{key:'Enter'},{key:'x'},{key:'v',ctrlKey:true,altKey:true},{key:'Process',isComposing:true,ctrlKey:true}]){
   const e=new f.dom.window.KeyboardEvent('keydown',{bubbles:true,cancelable:true,...values});d.dispatchEvent(e);assert(!e.defaultPrevented);
  }
 }finally{await f.close();}
});
