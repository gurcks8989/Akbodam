import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {configureBrowser} from '../scripts/configure-browser.mjs';
test('Pi browser configuration preserves preferences, is repeatable, and rejects a running profile',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'akbodam-browser-config-'));
 try {
  const prefs=path.join(dir,'browser/Default/Preferences');fs.mkdirSync(path.dirname(prefs),{recursive:true});
  fs.writeFileSync(prefs,JSON.stringify({custom:'keep',profile:{other:true}}));
  configureBrowser(dir);configureBrowser(dir);
  const result=JSON.parse(fs.readFileSync(prefs));assert.equal(result.custom,'keep');assert.equal(result.profile.other,true);assert.equal(result.profile.password_manager_enabled,false);assert.equal(result.signin.allowed,false);
  assert.equal(fs.readFileSync(path.join(dir,'browser-flags.txt'),'utf8'),'--password-store=basic\n');
  fs.symlinkSync('nonexistent-host-1234',path.join(dir,'browser/SingletonLock'));
  assert.throws(()=>configureBrowser(dir),/창을 모두 닫고/);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
