#!/usr/bin/env bash
set -euo pipefail
APP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"
mkdir -p data
exec >> "$APP_DIR/data/browser-launcher.log" 2>&1
if command -v chromium >/dev/null; then BROWSER_BIN=chromium; elif command -v chromium-browser >/dev/null; then BROWSER_BIN=chromium-browser; else echo 'Chromium을 설치해 주세요.'; exit 1; fi
if ! curl --max-time 2 --silent --fail http://127.0.0.1:4173/api/state >/dev/null; then
  if command -v systemctl >/dev/null && systemctl --user cat akbodam.service >/dev/null 2>&1; then
    # The service has an absolute Node path; this shell need not load nvm.
    systemctl --user start akbodam.service
  else
    if ! command -v node >/dev/null; then
      export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
      if [[ -s "$NVM_DIR/nvm.sh" ]]; then
        set +u
        source "$NVM_DIR/nvm.sh"
        nvm use 24
        set -u
      fi
    fi
    command -v node >/dev/null || { echo 'Node.js 설치 또는 자동 실행 등록이 필요합니다.'; exit 1; }
    node -e 'const [a,b]=process.versions.node.split(".").map(Number);if(a<22||(a===22&&b<13))process.exit(1)'
    nohup node bootstrap.mjs >> data/launcher.log 2>&1 &
  fi
fi
for attempt in {1..60}; do
  if curl --max-time 2 --silent --fail http://127.0.0.1:4173/api/state >/dev/null; then
    if [[ "${1:-}" = --kiosk ]]; then
      exec "$BROWSER_BIN" --kiosk --no-first-run --noerrdialogs --user-data-dir="$APP_DIR/data/browser" http://127.0.0.1:4173
    fi
    exec "$BROWSER_BIN" --app=http://127.0.0.1:4173
  fi
  sleep 1
done
echo '서버가 응답하지 않아 Chromium을 열지 않았습니다.'
if command -v journalctl >/dev/null; then journalctl --user -u akbodam.service -n 30 --no-pager || true; fi
exit 1
