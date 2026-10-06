#!/usr/bin/env bash
set -euo pipefail
[[ "$(uname -s)" = Linux && "$EUID" != 0 ]] || { echo 'Linux 데스크톱 사용자로 sudo 없이 실행하세요.'; exit 1; }
python3 - <<'PY'
import os,pathlib,subprocess,xml.etree.ElementTree as ET,shlex,shutil,tempfile
home=pathlib.Path.home(); config=home/'.config'; data=home/'.local/share'
backup=pathlib.Path(tempfile.mkdtemp(prefix='akbodam-emoji-backup-',dir=home))
def write(p,text):
    p.parent.mkdir(parents=True,exist_ok=True)
    if p.exists(): shutil.copy2(p,backup/str(p.relative_to(home)).replace('/','__'))
    p.write_text(text)
xml=subprocess.check_output(['gresource','extract','/usr/bin/squeekboard','/sm/puri/squeekboard/popover.ui'],text=True)
root=ET.fromstring(xml)
removed=0
for parent in root.iter():
    for item in list(parent):
        if item.tag=='item' and any(a.get('name')=='target' and a.text=='emoji' for a in item.findall('attribute')):
            parent.remove(item); removed+=1
if not removed: raise SystemExit('이 버전에서 이모지 메뉴를 찾지 못했습니다. 설정은 변경하지 않았습니다.')
overlay=data/'akbodam/squeekboard-ui';overlay.mkdir(parents=True,exist_ok=True)
write(overlay/'popover.ui',ET.tostring(root,encoding='unicode'))
entry='/sm/puri/squeekboard='+str(overlay)
if any(c in str(overlay) for c in '\n,:'): raise SystemExit('지원하지 않는 홈 경로입니다.')
wrapper=home/'.local/bin/akbodam-squeekboard'
write(wrapper,'#!/bin/sh\nexport G_RESOURCE_OVERLAYS='+shlex.quote(entry)+'\nexec /usr/bin/squeekboard "$@"\n');wrapper.chmod(0o755)
# User menu launchers survive package updates and preserve the distribution metadata.
for name in ['sm.puri.Squeekboard.desktop','sm.puri.OSK0.desktop']:
    source=pathlib.Path('/usr/share/applications')/name
    if source.exists():
        text=source.read_text();text='\n'.join('Exec="'+str(wrapper)+'"' if line.startswith('Exec=') else line for line in text.splitlines())+'\n'
        write(data/'applications'/name,text)
env=config/'labwc/environment';lines=env.read_text().splitlines() if env.exists() else []
old=next((l.split('=',1)[1] for l in lines if l.startswith('G_RESOURCE_OVERLAYS=')),os.environ.get('G_RESOURCE_OVERLAYS',''))
parts=[p for p in old.split(':') if p and not p.startswith('/sm/puri/squeekboard=')];parts.append(entry)
value=':'.join(parts)
lines=[l for l in lines if not l.startswith('G_RESOURCE_OVERLAYS=')];lines.append('G_RESOURCE_OVERLAYS='+value)
write(env,'\n'.join(lines)+'\n')
subprocess.run(['systemctl','--user','set-environment','G_RESOURCE_OVERLAYS='+value],check=True)
print('이모지 메뉴 숨김 완료. 백업:',backup)
print('즉시 실행: ~/.local/bin/akbodam-squeekboard (기존 키보드 종료 후)')
print('패널 버튼의 재실행에도 적용하려면 데스크톱에서 로그아웃 후 다시 로그인하세요.')
PY
