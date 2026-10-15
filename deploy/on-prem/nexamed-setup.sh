#!/usr/bin/env bash
# Mở TRÌNH CÀI ĐẶT/NÂNG CẤP NEXAMed trên Linux / NAS / VPS (docs/DECISIONS.md #238).
#
# Script chỉ là "cửa bật": kiểm tra Docker, nạp ảnh của trình cài đặt từ thư mục images, chạy container `nexamed-setup`
# (trang web hướng dẫn). Mọi câu hỏi và việc cài/nâng cấp thật nằm trong trang web đó. Dùng cho cả cài mới lẫn nâng cấp:
# giải nén gói mới đè lên thư mục cũ rồi chạy lại lệnh này.
#
# Mặc định (máy chủ không có màn hình): in link kèm mã dùng một lần; cổng 8090 chỉ mở tạm, cần mã, tự đóng khi cài xong.
#   ./nexamed-setup.sh                 -> http://<IP máy>:8090/?key=<mã>
#   ./nexamed-setup.sh --tunnel        -> chỉ gắn 127.0.0.1, không cần mã; mở bằng đường hầm SSH:
#                                         ssh -L 8090:localhost:8090 <tài-khoản>@<IP máy>   rồi mở http://localhost:8090
# Tuỳ chọn: --version <phiên bản>, --port <cổng>
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
cd "$HERE"

VERSION=""
PORT=8090
TUNNEL=0
while [ $# -gt 0 ]; do
  case "$1" in
    --version) VERSION="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --tunnel|--local) TUNNEL=1; shift ;;
    *) echo "Tham số không nhận diện được: $1" >&2; exit 1 ;;
  esac
done

step() { echo ""; echo "==> $1"; }

# ---- 1. Docker ----
step "Kiểm tra Docker"
if ! docker version --format '{{.Server.Version}}' >/dev/null 2>&1; then
  cat >&2 <<'EOF'

Chưa dùng được Docker trên máy này.
  1. Cài Docker Engine kèm plugin Compose (hoặc Container Manager / Container Station trên NAS).
  2. Bảo đảm tài khoản đang chạy lệnh được phép dùng Docker (nhóm "docker") hoặc chạy bằng sudo.
  3. Chạy lại lệnh này.
EOF
  exit 1
fi
echo "OK"

# ---- 2. Nạp ảnh trình cài đặt ----
step "Chuẩn bị trình cài đặt"
IMAGES_DIR="$HERE/images"
if [ -z "$VERSION" ] && [ -d "$IMAGES_DIR" ]; then
  VERSION="$(find "$IMAGES_DIR" -maxdepth 1 -name 'nexamed-setup-*.tar*' -exec basename {} \; 2>/dev/null \
    | sed -E 's/^nexamed-setup-//; s/\.tar(\.gz)?$//' | sort -V | tail -n 1)"
fi
if [ -z "$VERSION" ]; then
  echo "Không thấy file nexamed-setup-<phiên bản>.tar.gz trong thư mục images. Giải nén đầy đủ gói cài đặt rồi chạy lại." >&2
  exit 1
fi
IMAGE="nexamed-setup:$VERSION"
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  FILE=""
  for f in "$IMAGES_DIR/nexamed-setup-$VERSION.tar.gz" "$IMAGES_DIR/nexamed-setup-$VERSION.tar"; do
    [ -f "$f" ] && FILE="$f" && break
  done
  if [ -z "$FILE" ]; then echo "Thiếu file ảnh nexamed-setup-$VERSION trong thư mục images." >&2; exit 1; fi
  echo "Nạp $FILE ..."
  docker load -i "$FILE"
fi
echo "OK - $IMAGE"

# ---- 3. Thông tin máy cho container ----
# IPv4 của máy (bỏ cầu nối Docker/ảo) — container không tự thấy IP mạng thật.
IPS=""
if command -v ip >/dev/null 2>&1; then
  IPS="$(ip -4 -o addr show scope global 2>/dev/null | awk '$2 !~ /^(docker|br-|veth|virbr)/ {print $4}' | cut -d/ -f1 | paste -sd, -)"
fi
if [ -z "$IPS" ] && command -v hostname >/dev/null 2>&1; then
  IPS="$(hostname -I 2>/dev/null | tr ' ' ',' | sed 's/,$//' || true)"
fi
FIRST_IP="${IPS%%,*}"

KEY=""
BIND="127.0.0.1"
if [ "$TUNNEL" -eq 0 ]; then
  KEY="$(LC_ALL=C tr -dc 'A-Za-z2-9' </dev/urandom | head -c 12 | sed -E 's/(....)(....)(....)/\1-\2-\3/' || true)"
  BIND="0.0.0.0"
fi

docker rm -f nexamed-setup >/dev/null 2>&1 || true

step "Khởi động trình cài đặt"
if [ "$TUNNEL" -eq 1 ]; then
  echo "Trình cài đặt chỉ mở trên chính máy này (127.0.0.1:$PORT), không cần mã."
  echo "Từ máy tính của bạn, mở đường hầm SSH rồi vào trình duyệt:"
  echo ""
  echo "    ssh -L $PORT:localhost:$PORT <tài-khoản>@${FIRST_IP:-<IP-máy-chủ>}"
  echo "    http://localhost:$PORT"
else
  echo "Trình cài đặt đã sẵn sàng. Mở link này trên máy tính của bạn:"
  echo ""
  echo "    http://${FIRST_IP:-<IP-máy-chủ>}:$PORT/?key=$KEY"
  echo ""
  echo "Cổng $PORT chỉ mở tạm, cần mã trên mới vào được, tự đóng khi cài xong. Nhấn Ctrl+C để huỷ."
  echo "Không mở được cổng $PORT từ ngoài? Chạy lại với --tunnel và dùng đường hầm SSH."
fi
echo ""

exec docker run --rm --name nexamed-setup \
  -p "$BIND:$PORT:8090" \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$HERE:/work" \
  -e "HOST_INSTALL_DIR=$HERE" \
  -e "HOST_INSTALL_DIR_DISPLAY=$HERE" \
  -e "HOST_IPS=$IPS" \
  -e "SETUP_VERSION=$VERSION" \
  -e "SETUP_IMAGE=$IMAGE" \
  -e "SETUP_KEY=$KEY" \
  "$IMAGE"
