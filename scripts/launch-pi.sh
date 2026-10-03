#!/usr/bin/env bash
set -euo pipefail
APP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$APP_DIR"
command -v node >/dev/null || { echo 'Node.js 22.13 이상을 먼저 설치해 주세요.'; exit 1; }
node -e 'const [major,minor]=process.versions.node.split(".").map(Number); if(major<22 || (major===22 && minor<13))process.exit(1)' || { echo 'Node.js 22.13 이상이 필요합니다.'; exit 1; }
if command -v chromium >/dev/null; then BROWSER_BIN=chromium; elif command -v chromium-browser >/dev/null; then BROWSER_BIN=chromium-browser; else echo 'Chromium을 설치해 주세요.'; exit 1; fi
mkdir -p data
if ! curl --silent --fail http://127.0.0.1:4173/api/state >/dev/null; then
  nohup node bootstrap.mjs >> data/launcher.log 2>&1 &
fi
for attempt in {1..30}; do
  if curl --silent --fail http://127.0.0.1:4173/api/state >/dev/null; then
    exec "$BROWSER_BIN" --app=http://127.0.0.1:4173
  fi
  sleep 1
done
echo '실행되지 않았습니다. data/launcher.log를 확인해 주세요.'
exit 1
