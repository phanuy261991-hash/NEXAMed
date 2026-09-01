#!/usr/bin/env bash
# Cài đặt NEXAMed on-premise trên Linux (máy chủ chuyên dụng hoặc NAS có Docker — Synology
# Container Manager, QNAP Container Station...) — S4-05. Tương đương install.ps1 (Windows PC),
# xem docs/Deploy.md Phần 2 để biết khi nào dùng file nào.
#
# Dùng: ./install.sh [--tenant-name "..."] [--admin-username "..."] [--admin-full-name "..."] \
#                     [--web-origin "http://192.168.1.50"] [--skip-tenant-creation]
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

TENANT_NAME=""
ADMIN_USERNAME=""
ADMIN_FULL_NAME=""
WEB_ORIGIN_ARG=""
SKIP_TENANT=0

while [ $# -gt 0 ]; do
  case "$1" in
    --tenant-name) TENANT_NAME="$2"; shift 2 ;;
    --admin-username) ADMIN_USERNAME="$2"; shift 2 ;;
    --admin-full-name) ADMIN_FULL_NAME="$2"; shift 2 ;;
    --web-origin) WEB_ORIGIN_ARG="$2"; shift 2 ;;
    --skip-tenant-creation) SKIP_TENANT=1; shift ;;
    *) echo "Tham số không nhận diện được: $1" >&2; exit 1 ;;
  esac
done

step() { echo ""; echo "==> $1"; }
warn() { echo "!! $1" >&2; }
random_secret() { openssl rand -hex "${1:-32}"; }

# ---- 1. Kiểm tra Docker ----
step "Kiểm tra Docker"
if ! docker version >/dev/null 2>&1; then
  echo "Không tìm thấy Docker đang chạy. Cài Docker Engine + plugin Compose (hoặc Container Manager/Container Station trên NAS) rồi chạy lại script này." >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose (plugin 'docker compose') không dùng được — cập nhật Docker." >&2
  exit 1
fi
echo "OK"

# ---- 2. .env ----
step "Cấu hình .env"
if [ ! -f "$HERE/.env" ]; then
  cp "$HERE/.env.example" "$HERE/.env"
  sed -i \
    -e "s/^POSTGRES_PASSWORD=.*/POSTGRES_PASSWORD=$(random_secret 24)/" \
    -e "s/^NEXAMED_APP_DB_PASSWORD=.*/NEXAMED_APP_DB_PASSWORD=$(random_secret 24)/" \
    -e "s/^JWT_SECRET=.*/JWT_SECRET=$(random_secret 32)/" \
    -e "s/^ENCRYPTION_KEY=.*/ENCRYPTION_KEY=$(random_secret 32)/" \
    "$HERE/.env"
  echo "Đã tạo .env với mật khẩu/khoá sinh ngẫu nhiên — KHÔNG chia sẻ file này."
else
  echo ".env đã tồn tại — giữ nguyên (không sinh lại bí mật)."
fi

WEB_ORIGIN="$WEB_ORIGIN_ARG"
if [ -z "$WEB_ORIGIN" ]; then
  read -r -p "Địa chỉ IP LAN của máy này (Enter để chỉ dùng http://localhost ngay trên máy này): " ip
  if [ -n "$ip" ]; then WEB_ORIGIN="http://$ip"; else WEB_ORIGIN="http://localhost"; fi
fi
sed -i "s#^WEB_ORIGIN=.*#WEB_ORIGIN=$WEB_ORIGIN#" "$HERE/.env"
echo "WEB_ORIGIN = $WEB_ORIGIN"

# ---- 3. config.json ----
step "Cấu hình config.json (web)"
[ -f "$HERE/config.json" ] || cp "$HERE/config.example.json" "$HERE/config.json"
node -e "
const fs = require('fs');
const p = '$HERE/config.json';
const c = JSON.parse(fs.readFileSync(p, 'utf8'));
c.apiBaseUrl = '$WEB_ORIGIN';
fs.writeFileSync(p, JSON.stringify(c, null, 2) + '\n');
" 2>/dev/null || {
  # Máy chưa có Node — sửa bằng sed như trên (đơn giản hơn nhưng đủ dùng cho file 2 khoá).
  sed -i "s#\"apiBaseUrl\": *\"[^\"]*\"#\"apiBaseUrl\": \"$WEB_ORIGIN\"#" "$HERE/config.json"
}
echo "apiBaseUrl trong config.json = $WEB_ORIGIN"

# ---- 4. Build + khởi động ----
step "Build ảnh Docker (lần đầu có thể mất 5-15 phút tuỳ máy)"
docker compose build

step "Khởi động stack (postgres, migrate, api, web, backup)"
docker compose up -d

# ---- 5. Chờ api sẵn sàng ----
step "Chờ dịch vụ api sẵn sàng"
ready=0
for _ in $(seq 1 60); do
  cid="$(docker compose ps -q api)"
  status="$(docker inspect --format='{{.State.Health.Status}}' "$cid" 2>/dev/null || true)"
  if [ "$status" = "healthy" ]; then ready=1; break; fi
  sleep 3
  printf '.'
done
echo ""
if [ "$ready" -eq 1 ]; then
  echo "api đã sẵn sàng."
else
  warn "api chưa báo healthy sau 3 phút — kiểm tra 'docker compose logs api' và 'docker compose logs migrate'."
fi

# ---- 6. Tạo phòng khám đầu tiên ----
if [ "$SKIP_TENANT" -eq 0 ]; then
  step "Tạo phòng khám (tenant) + tài khoản quản trị đầu tiên"
  echo "Bỏ qua bước này (chạy lại với --skip-tenant-creation) nếu phòng khám đã được tạo trước đó."
  [ -n "$TENANT_NAME" ] || read -r -p "Tên phòng khám (ví dụ: Phòng khám Đa khoa ABC): " TENANT_NAME
  [ -n "$ADMIN_USERNAME" ] || read -r -p "Tên đăng nhập tài khoản quản trị đầu tiên: " ADMIN_USERNAME
  [ -n "$ADMIN_FULL_NAME" ] || read -r -p "Họ tên tài khoản quản trị đầu tiên: " ADMIN_FULL_NAME

  if [ -n "$TENANT_NAME" ] && [ -n "$ADMIN_USERNAME" ] && [ -n "$ADMIN_FULL_NAME" ]; then
    docker compose run --rm \
      -e "TENANT_NAME=$TENANT_NAME" \
      -e "ADMIN_USERNAME=$ADMIN_USERNAME" \
      -e "ADMIN_FULL_NAME=$ADMIN_FULL_NAME" \
      migrate pnpm run db:seed:pilot-tenant
    warn "Chép LẠI tenantId và mật khẩu tự sinh ở trên — mật khẩu chỉ hiện ĐÚNG MỘT LẦN."
    echo "Dán tenantId vừa in ra vào $HERE/config.json (khoá tenantId), rồi chạy: docker compose restart web"
  else
    warn "Bỏ qua tạo tenant (thiếu thông tin). Tạo sau bằng tay — xem docs/Deploy.md Phần 2."
  fi
fi

# ---- 7. Hoàn tất ----
step "Hoàn tất"
echo "Truy cập: $WEB_ORIGIN"
echo ""
echo "Máy chủ Linux/NAS: Docker daemon chạy như dịch vụ hệ thống (systemd trên server, Container"
echo "Manager/Container Station trên NAS) — tự khởi động cùng máy, không cần đăng nhập người dùng"
echo "như Windows. Container đã đặt restart:unless-stopped nên tự chạy lại sau khi máy khởi động"
echo "lại, không cần thao tác gì thêm."
echo ""
echo "Xem docs/Deploy.md để biết cách sao lưu/phục hồi, xử lý sự cố thường gặp."