#!/usr/bin/env bash
set -euo pipefail
[[ "$(uname -s)" = Linux ]] || { echo 'Linux에서 실행해 주세요.'; exit 1; }
systemctl --user disable --now akbodam.service
rm -f "$HOME/.config/systemd/user/akbodam.service" "$HOME/.config/autostart/akbodam.desktop"
systemctl --user daemon-reload
echo '자동 실행을 해제했습니다. 악보와 콘티는 유지됩니다.'
