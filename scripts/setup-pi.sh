#!/usr/bin/env bash
# Run as the desktop user: bash scripts/setup-pi.sh
set -euo pipefail
APP_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
[[ "$(uname -s)" = Linux ]] || { echo 'Raspberry Pi OS/Debian 계열 Linux 데스크톱에서 실행해 주세요.'; exit 1; }
[[ "$EUID" != 0 ]] || { echo 'sudo를 붙이지 말고 데스크톱 사용자로 실행해 주세요. 필요한 단계에서만 비밀번호를 요청합니다.'; exit 1; }
command -v apt-get >/dev/null && command -v dpkg >/dev/null || { echo 'apt를 사용하는 Debian 계열 OS가 필요합니다.'; exit 1; }
case "$(dpkg --print-architecture)" in
  arm64|amd64) ;;
  *) echo '64비트 OS가 필요합니다. Raspberry Pi OS 64비트 데스크톱을 사용해 주세요.'; exit 1 ;;
esac
command -v systemctl >/dev/null || { echo 'systemd를 사용하는 데스크톱 환경이 필요합니다.'; exit 1; }
systemctl --user show-environment >/dev/null || { echo '데스크톱에 로그인한 사용자의 터미널에서 실행해 주세요.'; exit 1; }
trap 'echo "설치가 중단됐습니다. 위 오류를 확인한 뒤 같은 명령을 다시 실행하세요." >&2' ERR

echo '[1/3] 기본 도구를 설치합니다. 관리자 비밀번호가 필요할 수 있습니다.'
sudo apt-get update
sudo apt-get install -y ca-certificates curl git xz-utils
if ! command -v chromium >/dev/null && ! command -v chromium-browser >/dev/null; then
  sudo apt-get install -y chromium
fi

node_ready() {
  command -v node >/dev/null && command -v npm >/dev/null &&
    node -e 'const [a,b]=process.versions.node.split(".").map(Number);if(a<22||(a===22&&b<13))process.exit(1)'
}
echo '[2/3] Node.js와 npm을 준비합니다.'
if ! node_ready; then
  export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
  if [[ ! -s "$NVM_DIR/nvm.sh" ]]; then
    installer="$(mktemp)"
    trap 'rm -f "${installer:-}"' EXIT
    curl --fail --show-error --location --retry 3 https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.7/install.sh -o "$installer"
    bash "$installer"
    rm -f "$installer"
  fi
  # nvm manages its own shell options; nounset is restored after setup.
  set +u
  source "$NVM_DIR/nvm.sh"
  nvm install -b 24
  nvm alias default 24
  nvm use 24
  set -u
fi
node_ready || { echo 'Node.js 22.13 이상과 npm 설치를 확인해 주세요.'; exit 1; }
node -v
npm -v

echo '[3/3] 악보담과 자동 실행을 설치합니다.'
bash "$APP_DIR/scripts/install-autostart.sh"
echo '설치 완료! OS에서 데스크톱 자동 로그인을 켠 뒤 재부팅하세요.'
echo '지금 바로 열려면 브라우저에서 http://127.0.0.1:4173 에 접속하세요.'
