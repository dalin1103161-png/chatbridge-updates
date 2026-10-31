// SPDX-License-Identifier: AGPL-3.0-only
const assert=require('node:assert/strict'),path=require('node:path');
const {createTranslator}=require('../extension/local-translator.cjs');
(async()=>{const t=createTranslator({resources:path.resolve('signal-source/release/win-unpacked/resources')});try{const zh=await t.translate('Hello, how are you?','zh-Hans');const en=await t.translate('你好，今天过得怎么样？','en');assert(/[\u3400-\u9fff]/.test(zh));assert(/[A-Za-z]/.test(en)&&!/[\u3400-\u9fff▁]/.test(en));assert(!zh.includes('▁'));console.log('Packaged offline Chinese-English translation passed.');}finally{t.close();}})().catch(e=>{console.error(e);process.exitCode=1;});
