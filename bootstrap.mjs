import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
const root=path.dirname(fileURLToPath(import.meta.url));
const data=path.resolve(process.env.SCORE_DATA_DIR || path.join(root,'data'));
const marker=path.join(data,'active-release.json');
let child, stopping=false, recovered=false;
function run() {
  let active=root;
  if(fs.existsSync(marker)) {
    const record=JSON.parse(fs.readFileSync(marker,'utf8'));
    const candidate=path.resolve(record.current);
    if(candidate!==root && !candidate.startsWith(path.join(data,'releases')+path.sep)) throw new Error('업데이트 경로가 올바르지 않습니다.');
    active=candidate;
  }
  const started=Date.now();
  child=spawn(process.execPath,[path.join(active,'server.mjs')],{cwd:active,stdio:'inherit',env:{...process.env,SCORE_DATA_DIR:data,AKBODAM_MANAGED:'1',AKBODAM_BASE_ROOT:root}});
  child.on('exit',code=>{
    if(!stopping && code===75) { recovered=false; run(); return; }
    if(!stopping && code && !recovered && Date.now()-started<15000 && fs.existsSync(marker)) {
      const record=JSON.parse(fs.readFileSync(marker,'utf8'));
      if(record.previous) { fs.writeFileSync(marker,JSON.stringify({...record,current:record.previous,previous:null})); recovered=true; console.error('새 버전 시작 실패: 이전 프로그램으로 복구합니다.'); run(); return; }
    }
    process.exit(code || 0);
  });
}
for(const signal of ['SIGINT','SIGTERM']) process.on(signal,()=>{stopping=true;child?.kill(signal);});
run();
