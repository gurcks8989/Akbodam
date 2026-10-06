#!/usr/bin/env bash
# Raspberry Pi OS / Debian desktop: run without sudo.
set -euo pipefail
[[ "$(uname -s)" = Linux ]] || { echo 'Raspberry Pi OS/Debian 계열 Linux에서 실행해 주세요.'; exit 1; }
[[ "$EUID" != 0 ]] || { echo 'sudo 없이 데스크톱 사용자로 실행해 주세요.'; exit 1; }
command -v apt-get >/dev/null || { echo 'apt 기반 OS가 필요합니다.'; exit 1; }
trap 'echo "설치가 중단됐습니다. 위 오류를 확인해 주세요." >&2' ERR

echo '[1/3] 한글 폰트와 입력기를 설치합니다.'
sudo apt-get update
sudo apt-get install -y fonts-noto-cjk fonts-nanum fontconfig fcitx5 fcitx5-hangul fcitx5-config-qt fcitx5-frontend-gtk3 fcitx5-frontend-gtk4 fcitx5-frontend-qt5 im-config

config_dir="${XDG_CONFIG_HOME:-$HOME/.config}"
backup_dir="$(mktemp -d "$HOME/akbodam-korean-backup-XXXXXX")"
echo "기존 설정 백업: $backup_dir"
if [[ -f "$HOME/.xinputrc" ]]; then cp -p "$HOME/.xinputrc" "$backup_dir/xinputrc"; fi
if [[ -d "$config_dir/fcitx5" ]]; then cp -a "$config_dir/fcitx5" "$backup_dir/"; fi
mkdir -p "$config_dir/fontconfig/conf.d" "$config_dir/autostart" "$config_dir/fcitx5"
font_config="$config_dir/fontconfig/conf.d/99-akbodam-korean.conf"
if [[ -f "$font_config" ]]; then cp -p "$font_config" "$backup_dir/"; fi
cat > "$font_config" <<'FONT'
<?xml version="1.0"?>
<!DOCTYPE fontconfig SYSTEM "urn:fontconfig:fonts.dtd">
<fontconfig>
  <match target="pattern">
    <test name="lang" compare="contains"><string>ko</string></test>
    <test name="family" compare="eq"><string>sans-serif</string></test>
    <edit name="family" mode="prepend" binding="strong"><string>Noto Sans CJK KR</string></edit>
  </match>
</fontconfig>
FONT
fc-cache -f

echo '[2/3] 사용자 한글 입력기를 설정합니다.'
im-config -n fcitx5
# Preserve an existing input-method list. Never rewrite a running daemon's profile.
if [[ ! -e "$config_dir/fcitx5/profile" ]] && ! pgrep -u "$(id -u)" -x fcitx5 >/dev/null; then
  cat > "$config_dir/fcitx5/profile" <<'PROFILE'
[Groups/0]
Name=Default
Default Layout=us
DefaultIM=hangul

[Groups/0/Items/0]
Name=keyboard-us
Layout=

[Groups/0/Items/1]
Name=hangul
Layout=

[GroupOrder]
0=Default
PROFILE
else
  echo '기존 입력기 목록은 유지했습니다. 재로그인 후 Fcitx 5 설정에서 Hangul(한글)을 추가하거나 확인하세요.'
fi
# Use the distribution launcher, retaining all desktop-specific launch settings.
if [[ -f /usr/share/applications/org.fcitx.Fcitx5.desktop && ! -e "$config_dir/autostart/org.fcitx.Fcitx5.desktop" ]]; then
  cp /usr/share/applications/org.fcitx.Fcitx5.desktop "$config_dir/autostart/"
fi

echo '[3/3] 한글 폰트를 확인합니다.'
fc-match 'sans-serif:lang=ko'
echo '설치 완료. 로그아웃 후 다시 로그인하거나 재부팅해 주세요.'
echo 'Fcitx 5 설정: fcitx5-configtool → 입력기에 Hangul(한글)이 있는지 확인'
echo '기본 전환은 Ctrl+Space입니다. 한/영 키 지정은 Fcitx 5 설정에서 변경하세요.'
echo 'Chromium 검색칸에서 한글 입력을 확인하세요. Wayland에서는 입력기 연동 설정이 추가로 필요할 수 있습니다.'
echo '이 스크립트는 한글 입력기와 폰트를 설치합니다. 터치 화상 키보드 및 OS 표시 언어는 변경하지 않습니다.'
