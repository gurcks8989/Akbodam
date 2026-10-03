import fs from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import os from 'node:os';
const exec = promisify(execFile);
export function repositoryUrl(value) {
  const input = String(value || '').trim().replace(/\.git$/, '').replace(/\/$/, '');
  if (!/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(input)) throw new Error('https://github.com/계정/저장소 형식으로 입력해 주세요.');
  return input;
}
export function versionParts(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(value);
  return match ? match.slice(1).map(Number) : null;
}
export function compareVersions(a,b) {
  const aa=versionParts(a), bb=versionParts(b); if(!aa || !bb) throw new Error('정식 버전 번호가 필요합니다.');
  for(let i=0;i<3;i++) if(aa[i]!==bb[i]) return aa[i]>bb[i]?1:-1; return 0;
}
export async function checkRelease(url,currentVersion) {
  const remote=repositoryUrl(url);
  let stdout;
  try { ({stdout}=await exec('git',['ls-remote','--tags',remote+'.git'],{timeout:20000,maxBuffer:2*1024*1024,env:{...process.env,GIT_TERMINAL_PROMPT:'0',GIT_ASKPASS:'/usr/bin/false'}})); }
  catch { throw new Error('저장소를 읽지 못했습니다. 주소·네트워크·비공개 저장소의 Git 인증을 확인해 주세요.'); }
  const tags=new Map();
  for(const line of stdout.trim().split('\n')) {
    const [sha,ref]=line.split(/\s+/); if(!ref) continue;
    const tag=ref.replace('refs/tags/','').replace(/\^\{\}$/,'');
    if(!versionParts(tag)) continue;
    if(!tags.has(tag)||ref.endsWith('^{}')) tags.set(tag,sha);
  }
  const tag=[...tags.keys()].sort((a,b)=>compareVersions(b,a))[0];
  if(!tag) return {currentVersion,repository:remote,latest:null,available:false,message:'배포된 정식 버전 태그가 없습니다. v0.1.0 형식의 태그가 필요합니다.'};
  return {currentVersion,repository:remote,latest:tag,commit:tags.get(tag),available:compareVersions(tag,currentVersion)>0,checkedAt:new Date().toISOString()};
}
export function backupData(dataDir,state) {
  const destination=path.join(dataDir,'backups',new Date().toISOString().replace(/[:.]/g,'-'));
  fs.mkdirSync(destination,{recursive:true});
  try {
    fs.writeFileSync(path.join(destination,'library.json'),JSON.stringify(state,null,2));
    if(fs.existsSync(path.join(dataDir,'scores'))) fs.cpSync(path.join(dataDir,'scores'),path.join(destination,'scores'),{recursive:true});
    fs.writeFileSync(path.join(destination,'backup.json'),JSON.stringify({createdAt:new Date().toISOString(),scores:state.scores.length,playlists:state.playlists.length},null,2));
    return {path:destination,createdAt:new Date().toISOString()};
  } catch(error) { fs.rmSync(destination,{recursive:true,force:true}); throw error; }
}
export async function prepareRelease(root,dataDir,release) {
  if(!release?.available || !versionParts(release.latest) || !/^[a-f0-9]{40}$/.test(release.commit||'')) throw new Error('먼저 새 버전을 확인해 주세요.');
  const remote=repositoryUrl(release.repository);
  const releases=path.join(dataDir,'releases'); fs.mkdirSync(releases,{recursive:true});
  const destination=fs.mkdtempSync(path.join(releases,release.latest+'-'));
  try {
    const env={...process.env,PATH:path.dirname(process.execPath)+path.delimiter+process.env.PATH,GIT_TERMINAL_PROMPT:'0',GIT_ASKPASS:'/usr/bin/false'};
    await exec('git',['clone','--depth','1','--branch',release.latest,'--single-branch',remote+'.git',destination],{timeout:120000,env});
    const {stdout}=await exec('git',['rev-parse','HEAD'],{cwd:destination});
    if(stdout.trim()!==release.commit) throw new Error('확인한 버전의 내용이 변경됐습니다. 다시 확인해 주세요.');
    const pkg=JSON.parse(fs.readFileSync(path.join(destination,'package.json'),'utf8'));
    if(pkg.name!=='akbodam' || compareVersions(pkg.version,release.latest)!==0 || !fs.existsSync(path.join(destination,'server.mjs'))) throw new Error('악보담 배포 구조나 버전이 올바르지 않습니다.');
    const npm=process.platform==='win32'?'npm.cmd':'npm';
    await exec(npm,['ci','--omit=dev','--ignore-scripts'],{cwd:destination,timeout:180000,maxBuffer:2*1024*1024,env});
    await exec(process.execPath,['--check','server.mjs'],{cwd:destination,timeout:10000});
    const probe=fs.mkdtempSync(path.join(os.tmpdir(),'akbodam-probe-'));
    try {
      await exec(process.execPath,['--input-type=module','-e',`import {createApp} from './server.mjs'; const s=createApp(process.argv[1]).listen(0,'127.0.0.1',async()=>{try {const r=await fetch('http://127.0.0.1:'+s.address().port+'/api/state'); if(!r.ok)throw Error('health'); const d=await r.json(); if(!Array.isArray(d.scores)||!Array.isArray(d.playlists))throw Error('format'); s.close();} catch(e){console.error(e);process.exit(1);}});`,probe],{cwd:destination,timeout:20000,env});
    } finally { fs.rmSync(probe,{recursive:true,force:true}); }

    return destination;
  } catch(error) { fs.rmSync(destination,{recursive:true,force:true}); throw new Error(error.message?.startsWith('Command failed')?'새 버전 준비에 실패했습니다. 저장소와 설치 환경을 확인해 주세요.':error.message); }
}
