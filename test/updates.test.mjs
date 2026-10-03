import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { repositoryUrl, compareVersions, backupData, prepareRelease } from '../updates.mjs';
import { createApp } from '../server.mjs';
test('update repository validation and numeric stable-version ordering',()=>{
 assert.equal(repositoryUrl('https://github.com/example/akbodam.git'),'https://github.com/example/akbodam');
 for(const bad of ['file:///private','https://github.com.evil/owner/repo','https://token@github.com/a/b','git@github.com:a/b','https://github.com/a/b/tree/main']) assert.throws(()=>repositoryUrl(bad));
 assert.equal(compareVersions('v0.10.0','0.9.9'),1);assert.equal(compareVersions('1.0.0','v1.0.0'),0);assert.throws(()=>compareVersions('v2.0.0-beta','1.0.0'));
});
test('backup preserves scores, settings and setlists independently; unchecked release cannot install',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'akbodam-update-test-'));
 const server=createApp(dir).listen(0,'127.0.0.1'); await new Promise(r=>server.once('listening',r));
 const base='http://127.0.0.1:'+server.address().port;
 try {
  const status=await (await fetch(base+'/api/updates')).json();assert.equal(status.currentVersion,JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url))).version);assert.equal(status.repository,'https://github.com/gurcks8989/Akbodam');
  assert.equal((await fetch(base+'/api/updates/install',{method:'POST'})).status,409);
  assert.equal((await fetch(base+'/api/updates/repository',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({repository:'https://github.com/example/akbodam'})})).status,200);
  fs.writeFileSync(path.join(dir,'scores','sample.pdf'),'example-original');
  const state=await (await fetch(base+'/api/state')).json();
  const backup=backupData(dir,state);fs.writeFileSync(path.join(dir,'scores','sample.pdf'),'changed');
  assert.equal(fs.readFileSync(path.join(backup.path,'scores','sample.pdf'),'utf8'),'example-original');
  assert.equal(JSON.parse(fs.readFileSync(path.join(backup.path,'library.json'))).settings.updateRepository,'https://github.com/example/akbodam');
  assert.ok(!fs.existsSync(path.join(backup.path,'backups')));
  await assert.rejects(prepareRelease('.',dir,{available:false}));
 } finally {await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});}
});

test('managed launcher restores the previous app if the new release fails to start', {timeout:15000}, async()=>{
 const {spawn}=await import('node:child_process');
 const root=path.resolve(new URL('..',import.meta.url).pathname);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'akbodam-recovery-'));
 const broken=path.join(dir,'releases','broken');fs.mkdirSync(broken,{recursive:true});
 fs.writeFileSync(path.join(broken,'server.mjs'),'process.exit(1);');
 fs.writeFileSync(path.join(dir,'active-release.json'),JSON.stringify({current:broken,previous:root}));
 const child=spawn(process.execPath,['bootstrap.mjs'],{cwd:root,env:{...process.env,SCORE_DATA_DIR:dir,PORT:'0'},stdio:['ignore','pipe','pipe']});
 const exited=new Promise(resolve=>child.once('exit',resolve));
 try {
  await new Promise((resolve,reject)=>{ let out=''; const timer=setTimeout(()=>reject(Error('recovery timed out')),10000);child.stdout.on('data',b=>{out+=b;if(out.includes('악보대:')){clearTimeout(timer);resolve();}});child.once('exit',()=>{clearTimeout(timer);reject(Error('launcher stopped'));});});
  const marker=JSON.parse(fs.readFileSync(path.join(dir,'active-release.json')));assert.equal(marker.current,root);assert.equal(marker.previous,null);
 } finally {child.kill('SIGTERM');await exited;fs.rmSync(dir,{recursive:true,force:true});}
});
