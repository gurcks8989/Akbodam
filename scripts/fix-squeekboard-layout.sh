#!/usr/bin/env bash
# Extend an existing Korean layout to Raspberry Pi Squeekboard input contexts.
set -euo pipefail
[[ "$(uname -s)" = Linux ]] || { echo 'Raspberry Pi OS에서 실행해 주세요.'; exit 1; }
[[ "$EUID" != 0 ]] || { echo 'sudo 없이 데스크톱 사용자로 실행해 주세요.'; exit 1; }
layout_dir=/usr/share/misc/squeekboard/keyboards
[[ -d "$layout_dir" ]] || { echo '이 스크립트는 Raspberry Pi OS의 Squeekboard 자판 경로용입니다.'; exit 1; }
source_layout="${1:-$layout_dir/kr.yaml}"
[[ -s "$source_layout" ]] || { echo '기존 한글 자판 YAML 파일 경로를 첫 인자로 지정해 주세요.'; exit 1; }
backup_dir="$(mktemp -d "$HOME/akbodam-squeekboard-backup-XXXXXX")"
printf '%s\n' "$source_layout" > "$backup_dir/source-path.txt"
cp "$source_layout" "$backup_dir/source.yaml"
gsettings get org.gnome.desktop.input-sources sources > "$backup_dir/input-sources.txt"
echo "기존 설정 백업: $backup_dir"
# Numeric/PIN and terminal layouts remain unchanged.
for relative in kr.yaml kr_wide.yaml url/kr.yaml url/kr_wide.yaml email/kr.yaml email/kr_wide.yaml; do
  target="$layout_dir/$relative"
  if [[ -e "$target" ]]; then
    mkdir -p "$backup_dir/$(dirname "$relative")"
    cp "$target" "$backup_dir/$relative"
  else
    printf '%s\n' "$relative" >> "$backup_dir/new-files.txt"
  fi
  sudo install -D -m 644 "$backup_dir/source.yaml" "$target"
done
# Preserve all selected languages and add Korean only if it is missing.
python3 - <<'PY'
import ast, subprocess
value=subprocess.check_output(['gsettings','get','org.gnome.desktop.input-sources','sources'],text=True).strip()
if value.startswith('@a(ss) '): value=value[7:]
sources=ast.literal_eval(value)
if ('xkb','kr') not in sources:
    sources.append(('xkb','kr'))
    subprocess.run(['gsettings','set','org.gnome.desktop.input-sources','sources',repr(sources)],check=True)
PY
echo '한국어 자판을 일반·가로·주소·이메일 입력칸에 연결했습니다. 키보드를 다시 열어 확인하세요.'
echo '기존 자판의 키 동작은 그대로입니다. 한글 조합 입력기까지 설치하거나 검증하는 스크립트는 아닙니다.'
