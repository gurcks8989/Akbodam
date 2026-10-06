import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';

for (const ready of [true,false]) test(`desktop launcher without Node in PATH: server ready=${ready}`,()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'akbodam-launcher-'));
  const bin=path.join(dir,'bin');fs.mkdirSync(bin);fs.mkdirSync(path.join(dir,'scripts'));
  fs.copyFileSync(new URL('../scripts/launch-pi.sh',import.meta.url),path.join(dir,'scripts','launch-pi.sh'));
  function mock(name,body){fs.writeFileSync(path.join(bin,name),'#!/bin/sh\n'+body,{mode:0o755});}
  for(const name of ['dirname','mkdir']) fs.symlinkSync(execFileSync('/usr/bin/which',[name],{encoding:'utf8'}).trim(),path.join(bin,name));
  mock('systemctl','echo "$*" >> "$TASK_TEST_DIR/service-calls"\nexit 0\n');
  mock('sleep','exit 0\n');
  mock('curl',ready?'if [ -f "$TASK_TEST_DIR/service-calls" ]; then exit 0; else exit 7; fi\n':'exit 7\n');
  mock('chromium','echo "$*" > "$TASK_TEST_DIR/browser-args"\n');
  try {
    const run=()=>execFileSync('/bin/bash',[path.join(dir,'scripts','launch-pi.sh'),'--kiosk'],{env:{...process.env,PATH:bin,TASK_TEST_DIR:dir},timeout:10000});
    if(ready){run();assert.match(fs.readFileSync(path.join(dir,'browser-args'),'utf8'),/--kiosk.*127.0.0.1:4173/);}
    else {assert.throws(run);assert.equal(fs.existsSync(path.join(dir,'browser-args')),false);}
    assert.match(fs.readFileSync(path.join(dir,'service-calls'),'utf8'),/--user start akbodam.service/);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
