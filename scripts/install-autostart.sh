#!/usr/bin/env bash
set -euo pipefail
APP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
[[ "$(uname -s)" = Linux ]] || { echo 'Linux 데스크톱에서 실행해 주세요.'; exit 1; }
[[ "$EUID" != 0 ]] || { echo 'sudo 없이 데스크톱 사용자로 실행해 주세요.'; exit 1; }
for tool in node npm git curl systemctl; do command -v "$tool" >/dev/null || { echo "$tool 설치가 필요합니다."; exit 1; }; done
NODE_BIN="$(command -v node)"
node -e 'const [a,b]=process.versions.node.split(".").map(Number);if(a<22||(a===22&&b<13))process.exit(1)' || { echo 'Node.js 22.13 이상이 필요합니다.'; exit 1; }
command -v chromium >/dev/null || command -v chromium-browser >/dev/null || { echo 'Chromium 설치가 필요합니다.'; exit 1; }
for value in "$APP_DIR" "$NODE_BIN" "$PATH"; do
  [[ "$value" != *'"'* && "$value" != *'`'* && "$value" != *'$'* && "$value" != *'%'* && "$value" != *'\'* && "$value" != *$'\n'* ]] || { echo '설치 경로에 특수문자를 사용할 수 없습니다.'; exit 1; }
done
cd "$APP_DIR"
npm ci --omit=dev --ignore-scripts
mkdir -p "$HOME/.config/systemd/user" "$HOME/.config/autostart"
cat > "$HOME/.config/systemd/user/akbodam.service" <<UNIT
[Unit]
Description=Akbodam local sheet music reader
[Service]
Type=simple
WorkingDirectory="$APP_DIR"
ExecStart="$NODE_BIN" "$APP_DIR/bootstrap.mjs"
Environment="PATH=$PATH"
Environment="SCORE_DATA_DIR=$APP_DIR/data"
Environment=PORT=4173
Restart=on-failure
RestartSec=3
[Install]
WantedBy=default.target
UNIT
cat > "$HOME/.config/autostart/akbodam.desktop" <<DESKTOP
[Desktop Entry]
Type=Application
Name=악보담
Exec=/usr/bin/env "PATH=$PATH" /bin/bash "$APP_DIR/scripts/launch-pi.sh" --kiosk
Terminal=false
DESKTOP
systemctl --user daemon-reload
systemctl --user enable --now akbodam.service
bash "$APP_DIR/scripts/install-pi-launcher.sh"
echo '자동 실행을 등록했습니다. 데스크톱 로그인 시 악보담이 전체화면으로 열립니다.'
echo '전원만 켜서 사용하려면 OS 설정에서 데스크톱 자동 로그인을 켜주세요.'
