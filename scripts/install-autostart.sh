#!/usr/bin/env bash
set -euo pipefail
APP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
[[ "$(uname -s)" = Linux ]] || { echo 'Linux 데스크톱에서 실행해 주세요.'; exit 1; }
[[ "$EUID" != 0 ]] || { echo 'sudo 없이 데스크톱 사용자로 실행해 주세요.'; exit 1; }
# Desktop terminals do not always load nvm automatically.
if ! command -v node >/dev/null || ! command -v npm >/dev/null; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [[ -s "$NVM_DIR/nvm.sh" ]]; then
    set +u
    source "$NVM_DIR/nvm.sh"
    nvm use 24
    set -u
  fi
fi
for tool in node npm git curl systemctl loginctl; do command -v "$tool" >/dev/null || { echo "$tool 설치가 필요합니다."; exit 1; }; done
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
WorkingDirectory=$APP_DIR
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
Icon=$APP_DIR/public/logo.png
Exec=/usr/bin/env "PATH=$PATH" /bin/bash "$APP_DIR/scripts/launch-pi.sh" --kiosk
Terminal=false
DESKTOP
if command -v systemd-analyze >/dev/null; then
  systemd-analyze --user verify "$HOME/.config/systemd/user/akbodam.service"
fi
# Linger starts the user's services at boot, before desktop login.
if [[ "$(loginctl show-user "$(id -un)" -p Linger --value)" != yes ]]; then
  echo '부팅 시 서버를 시작하도록 설정합니다. 관리자 비밀번호가 필요할 수 있습니다.'
  sudo loginctl enable-linger "$(id -un)"
fi
systemctl --user daemon-reload
if ! systemctl --user enable --now akbodam.service; then
  systemctl --user status akbodam.service --no-pager || true
  journalctl --user -u akbodam.service -n 30 --no-pager || true
  exit 1
fi
ready=false
for attempt in {1..30}; do
  if curl --max-time 2 --silent --fail http://127.0.0.1:4173/api/state >/dev/null; then ready=true; break; fi
  sleep 1
done
if [[ "$ready" != true ]]; then
  echo '서버가 응답하지 않습니다. 아래 로그를 확인해 주세요.'
  journalctl --user -u akbodam.service -n 30 --no-pager || true
  exit 1
fi
bash "$APP_DIR/scripts/install-pi-launcher.sh"
echo '서버 실행을 확인했습니다. 다음 부팅부터 서버가 자동 시작되고, 데스크톱 로그인 후 Chromium이 열립니다.'
echo '전원만 켜서 사용하려면 OS 설정에서 데스크톱 자동 로그인을 켜주세요.'
