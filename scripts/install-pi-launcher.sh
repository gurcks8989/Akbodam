#!/usr/bin/env bash
set -euo pipefail
APP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
[[ "$(uname -s)" = Linux ]] || { echo '이 설치 도구는 Raspberry Pi OS/Linux용입니다.'; exit 1; }
[[ "$APP_DIR" != *'"'* && "$APP_DIR" != *'`'* && "$APP_DIR" != *'$'* && "$APP_DIR" != *'%'* && "$APP_DIR" != *'\'* ]] || { echo '따옴표, 역슬래시, %, $, 백틱이 없는 경로에 두세요.'; exit 1; }
chmod +x "$APP_DIR/scripts/launch-pi.sh"
mkdir -p "$HOME/.local/share/applications"
cat > "$HOME/.local/share/applications/akbodam.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=악보담
Icon=$APP_DIR/public/logo.png
Comment=이 기기에 저장된 악보와 콘티
Exec="$APP_DIR/scripts/launch-pi.sh"
Terminal=false
Categories=AudioVideo;Music;
EOF
echo '앱 메뉴에 악보담 실행 아이콘을 만들었습니다.'
