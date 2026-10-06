import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export function configureBrowser(dataDir) {
  const profile=path.join(dataDir,'browser');
  // Chromium owns Preferences while running; never edit them concurrently.
  if(fs.existsSync(path.join(profile,'SingletonLock')) || (()=>{try{fs.lstatSync(path.join(profile,'SingletonLock'));return true;}catch{return false;}})()) {
    throw new Error('악보담 Chromium 창을 모두 닫고 설치를 다시 실행해 주세요.');
  }
  const prefs=path.join(profile,'Default','Preferences');
  fs.mkdirSync(path.dirname(prefs),{recursive:true});
  const settings=fs.existsSync(prefs)?JSON.parse(fs.readFileSync(prefs,'utf8')):{};
  if(fs.existsSync(prefs)) fs.copyFileSync(prefs,prefs+'.before-akbodam-setup');
  settings.credentials_enable_service=false;
  settings.profile={...settings.profile,password_manager_enabled:false};
  settings.signin={...settings.signin,allowed:false};
  fs.writeFileSync(prefs+'.tmp',JSON.stringify(settings));fs.renameSync(prefs+'.tmp',prefs);
  const flags=path.join(dataDir,'browser-flags.txt');
  const current=fs.existsSync(flags)?fs.readFileSync(flags,'utf8'):'';
  if(!current.split(/\r?\n/).includes('--password-store=basic')) fs.writeFileSync(flags,current+(current&&!current.endsWith('\n')?'\n':'')+'--password-store=basic\n');
}
if(process.argv[1]===fileURLToPath(import.meta.url)) {
  try {configureBrowser(path.resolve(process.argv[2]));console.log('악보담 전용 Chromium 호환 설정 적용 완료 (비밀번호 저장·브라우저 로그인 끔)');}
  catch(error){console.error(error.message);process.exitCode=1;}
}
