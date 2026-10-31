// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const { installPreload } = require('../extension/preload.cjs');

function fixture(whatsapp=false,html) {
  const dom = new JSDOM(html || '<!doctype html><body><div class="module-ConversationHeader__header__info__title">Friend</div><div data-message-id="old"><span class="module-message__text">Hello from history</span></div></body>', { url:'https://fixture.invalid' });
  const old = { document:global.document, interval:global.setInterval, installed:global.__chatbridgeInstalled };
  global.document = dom.window.document;
  global.setInterval = () => 1;
  delete global.__chatbridgeInstalled;
  const calls = [];
  const ipc = { invoke:async (_channel,method,value) => {
    calls.push({method,value});
    if (method === 'accounts') return [{id:'wa-one',name:'Work WA'},{id:'wa-two',name:'Personal WA'}];
    if (method === 'signal-accounts') return {accounts:[{id:'default',name:'Signal Work'}],current:'default'};
    if (method === 'add-whatsapp') return {id:'test-account',name:value};
    if (method === 'translate') return '<b>译文作为纯文字</b>';
    return true;
  } };
  const api = installPreload({ipc,whatsapp});
  dom.window.document.dispatchEvent(new dom.window.Event('DOMContentLoaded'));
  return {dom,api,calls,
    close(){global.document=old.document;global.setInterval=old.interval;global.__chatbridgeInstalled=old.installed;dom.window.close();}};
}

test('history stays original until its individual translate button is clicked', async () => {
  const f=fixture(); try {
    assert(f.dom.window.document.querySelector('[data-chatbridge-message] button'));
    assert.equal(f.calls.filter(x=>x.method==='translate').length,0);
    f.dom.window.document.querySelector('[data-chatbridge-message] button').click();
    await f.api.state.serial;
    const output=f.dom.window.document.querySelector('[data-chatbridge-output]');
    assert.equal(output.textContent,'<b>译文作为纯文字</b>');
    assert.equal(output.querySelector('b'),null);
    assert.equal(f.dom.window.document.querySelector('[data-chatbridge-message] button').hidden,true);
    assert.equal(output.parentElement.previousElementSibling.textContent,'Hello from history');
    assert.equal(f.calls.filter(x=>x.method==='translate').length,1);
  } finally {f.close();}
});
test('new-message translation is independent from history translation',async()=>{
  const f=fixture();try {
    f.api.state.incoming=true;
    const node=f.dom.window.document.createElement('div');node.setAttribute('data-message-id','new');
    const text=f.dom.window.document.createElement('span');text.className='module-message__text';text.textContent='New message';node.append(text);f.dom.window.document.body.append(node);
    f.api.scan();await f.api.state.serial;
    assert.equal(f.api.state.history,false);
    const calls=f.calls.filter(x=>x.method==='translate');assert.equal(calls.length,1);assert.equal(calls[0].value.text,'New message');
    assert.equal(f.dom.window.document.querySelector('[data-message-id="old"] [data-chatbridge-output]').textContent,'');
  }finally{f.close();}
});
test('disabling history cancels automatic work that has not started',async()=>{
  const f=fixture();try {
    f.api.state.history=true;f.api.scan();f.api.state.history=false;
    await f.api.state.serial;
    assert.equal(f.calls.filter(x=>x.method==='translate').length,0);
  }finally{f.close();}
});

test('adding WhatsApp uses a visible form and default name; blank input never calls IPC', async()=>{
  const f=fixture();try {
    const d=f.dom.window.document;
    const add=[...d.querySelectorAll('button')].find(b=>b.textContent==='＋ 添加 WhatsApp');
    await add.onclick(); await add.onclick();
    assert.equal(d.querySelectorAll('[data-chatbridge-add-account]').length,1);
    const form=d.querySelector('[data-chatbridge-add-account]');
    const input=form.querySelector('input'), save=form.querySelector('button');
    assert.equal(input.value,'WhatsApp 3');
    input.value=' '; await save.onclick();
    assert.equal(f.calls.filter(c=>c.method==='add-whatsapp').length,0);
    input.value=' Work '; await save.onclick();
    assert.equal(f.calls.find(c=>c.method==='add-whatsapp').value,'Work');
    assert.equal(d.querySelector('[data-chatbridge-add-account]'),null);
    assert.equal(d.querySelector('[data-cb-sidebar]').style.width,'200px');
  }finally{f.close();}
});

test('each account appears separately in the sidebar instead of a dropdown',async()=>{
 const f=fixture();try{
  await new Promise(r=>setImmediate(r));
  const d=f.dom.window.document;
  assert.equal(d.querySelectorAll('[data-cb-account]').length,3);
  assert.equal(d.querySelector('[aria-label="WhatsApp accounts"]'),null);
  assert.equal(d.querySelector('[aria-label="Signal accounts"]'),null);
  await d.querySelector('[data-cb-account="whatsapp:wa-two"] button').onclick();
  assert(f.calls.some(c=>c.method==='whatsapp'&&c.value==='wa-two'));
 }finally{f.close();}
});


test('WhatsApp translation stays inside the original bubble, below text without a label',async()=>{
 const f=fixture(true,'<!doctype html><body><div id="app"><div id="main"><div data-id="false_friend_message"><div class="bubble"><div data-pre-plain-text="Friend"><span class="selectable-text">Honey. What problem are you encountering?</span></div></div></div></div></div></body>');try{
  const d=f.dom.window.document,box=d.querySelector('[data-chatbridge-message]');
  assert(box);assert.equal(box.parentElement.getAttribute('data-pre-plain-text'),'Friend');
  assert.equal(box.previousElementSibling.textContent,'Honey. What problem are you encountering?');
  box.querySelector('button').click();await f.api.state.serial;
  assert.equal(box.querySelector('[data-chatbridge-output]').textContent,'<b>译文作为纯文字</b>');
  assert.equal(box.querySelector('button').hidden,true);
  f.api.scan();assert.equal(f.api.messageRows().rows[0].text,'Honey. What problem are you encountering?');
 }finally{f.close();}
});


test('history translation stays enabled across chats until manually switched off',async()=>{
 const f=fixture();try{
  const d=f.dom.window.document,checkbox=[...d.querySelectorAll('label')].find(e=>e.textContent==='历史翻译').querySelector('input');
  checkbox.checked=true;checkbox.onchange();await f.api.state.serial;
  const title=d.querySelector('.module-ConversationHeader__header__info__title');
  title.textContent='Second friend';d.querySelector('.module-message__text').textContent='A different conversation';f.api.scan();await f.api.state.serial;
  assert.equal(checkbox.checked,true);assert.equal(f.api.state.history,true);
  assert(f.calls.some(c=>c.method==='translate'&&c.value.text==='A different conversation'));
  checkbox.checked=false;checkbox.onchange();
  const before=f.calls.filter(c=>c.method==='translate').length;
  title.textContent='Third friend';d.querySelector('.module-message__text').textContent='Manual translation only';f.api.scan();await f.api.state.serial;
  assert.equal(checkbox.checked,false);assert.equal(f.api.state.history,false);
  assert.equal(f.calls.filter(c=>c.method==='translate').length,before);
 }finally{f.close();}
});
