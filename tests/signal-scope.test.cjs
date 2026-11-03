// SPDX-License-Identifier: AGPL-3.0-only
'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const baseline=require('../docs/browser-environment-baseline.json');
test('browser environment development preserves the existing Signal runtime sources',()=>{
 for(const [file,expected]of Object.entries(baseline.protectedFiles)){
  const data=fs.readFileSync(path.join(__dirname,'..',file),'utf8').replace(/\r\n/g,'\n');
  assert.equal(crypto.createHash('sha256').update(data).digest('hex'),expected,'Signal runtime changed: '+file);
 }
});
