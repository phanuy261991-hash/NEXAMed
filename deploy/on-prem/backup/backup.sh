#!/usr/bin/env bash
# Sao lưu Postgres hằng ngày cho bản cài on-prem (S4-05, chuẩn bị hạ tầng cho S6-01/S6-02 —
# lịch tự động + diễn tập phục hồi đầy đủ CHƯA làm ở phiên này, xem docs/Deploy.md).
# Chạy `pg_dump` custom format (-Fc, hỗ trợ `pg_restore` chọn lọc bảng/song song) ra $BACKUP_DIR
# (bind-mount thư mục ngoài container — nên trỏ ra ổ đĩa khác/ổ ngoài theo đúng khuyến nghị
# `.claude/docs/project-structure.md`: "Backup ghi ra thư mục cấu hình được").
set -euo pipefail

: "${POSTGRES_HOST:?thiếu POSTGRES_HOST}"
: "${POSTGRES_DB:?thiếu POSTGRES_DB}"
: "${POSTGRES_USER:?thiếu POSTGRES_USER}"
: "${POSTGRES_PASSWORD:?thiếu POSTGRES_PASSWORD}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
BACKUP_HOUR="${BACKUP_HOUR:-2}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"

export PGPASSWORD="$POSTGRES_PASSWORD"
mkdir -p "$BACKUP_DIR"

run_backup() {
  local ts file
  ts="$(date +%Y%m%d-%H%M%S)"
  file="$BACKUP_DIR/nexamed-${POSTGRES_DB}-${ts}.dump"
  echo "[backup] $(date -Iseconds) bắt đầu sao lưu → $file"
  if pg_dump -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f "$file"; then
    echo "[backup] $(date -Iseconds) THÀNH CÔNG ($(du -h "$file" | cut -f1))"
  else
    echo "[backup] $(date -Iseconds) THẤT BẠI — kiểm tra log phía trên và dung lượng đĩa còn trống." >&2
    rm -f "$file"
    return 1
  fi
  # Dọn bản cũ quá hạn giữ (mặc định 14 ngày) — tránh đầy đĩa PC phòng khám theo thời gian.
  find "$BACKUP_DIR" -maxdepth 1 -name 'nexamed-*.dump' -mtime "+${BACKUP_RETENTION_DAYS}" -print -delete
}

echo "[backup] Chờ Postgres sẵn sàng..."
until pg_isready -h "$POSTGRES_HOST" -U "$POSTGRES_USER" >/dev/null 2>&1; do
  sleep 2
done

echo "[backup] Sẵn sàng — sao lưu ngay lần đầu, sau đó lặp lại hằng ngày lúc ${BACKUP_HOUR}:00 (giờ container)."
run_backup || true

while true; do
  now_epoch=$(date +%s)
  next=$(date -d "today ${BACKUP_HOUR}:00" +%s)
  if [ "$next" -le "$now_epoch" ]; then
    next=$(date -d "tomorrow ${BACKUP_HOUR}:00" +%s)
  fi
  sleep_seconds=$(( next - now_epoch ))
  echo "[backup] Chờ $((sleep_seconds/3600))h $(((sleep_seconds%3600)/60))m tới lần sao lưu kế tiếp ($(date -d "@$next" -Iseconds))."
  sleep "$sleep_seconds"
  run_backup || true
done