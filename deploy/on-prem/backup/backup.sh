#!/usr/bin/env bash
# Sao lưu Postgres hằng ngày cho bản cài on-prem (S4-05, hạ tầng lịch tự động — diễn tập phục hồi
# đầy đủ ở S6-02, xem docs/Deploy.md).
# Chạy `pg_dump` custom format (-Fc, hỗ trợ `pg_restore` chọn lọc bảng/song song) ra $BACKUP_DIR
# (bind-mount thư mục ngoài container — nên trỏ ra ổ đĩa khác/ổ ngoài theo đúng khuyến nghị
# `.claude/docs/project-structure.md`: "Backup ghi ra thư mục cấu hình được").
#
# S6-01 (ADM-04, docs/DECISIONS.md #141) — sau MỖI lần chạy (thành công hay thất bại), ghi trạng
# thái ra $BACKUP_STATUS_FILE (JSON) trên 1 volume dùng chung với container `api` — API đọc file
# này qua BackupStatusPort (apps/api/src/infrastructure/backup-status/local-file.adapter.ts) để
# hiện banner cảnh báo cho clinic_admin khi backup thất bại/trễ hạn. Container `backup` chạy TÁCH
# BIỆT khỏi tiến trình API (không qua NestJS DI) nên không gọi thẳng port — chỉ ghi file, API tự
# đọc lúc có request.
set -euo pipefail

: "${POSTGRES_HOST:?thiếu POSTGRES_HOST}"
: "${POSTGRES_DB:?thiếu POSTGRES_DB}"
: "${POSTGRES_USER:?thiếu POSTGRES_USER}"
: "${POSTGRES_PASSWORD:?thiếu POSTGRES_PASSWORD}"
BACKUP_DIR="${BACKUP_DIR:-/backups}"
BACKUP_HOUR="${BACKUP_HOUR:-2}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
BACKUP_STATUS_FILE="${BACKUP_STATUS_FILE:-/status/backup-status.json}"

export PGPASSWORD="$POSTGRES_PASSWORD"
mkdir -p "$BACKUP_DIR" "$(dirname "$BACKUP_STATUS_FILE")"

# Ghi trạng thái ATOMIC (file tạm rồi `mv`, tránh API đọc trúng lúc ghi dở) — cộng dồn
# `consecutiveFailures` bằng cách đọc lại giá trị đã ghi lần trước (nếu có). `jq` có sẵn trong ảnh
# (thêm ở Dockerfile) — dùng thay parse JSON tay bằng sed/awk cho chắc chắn đúng escape.
write_status() {
  local ok="$1" error_msg="${2:-}" now prev_failures prev_success last_success_at consecutive_failures
  now="$(date -Iseconds)"
  if [ -f "$BACKUP_STATUS_FILE" ]; then
    prev_failures="$(jq -r '.consecutiveFailures // 0' "$BACKUP_STATUS_FILE" 2>/dev/null || echo 0)"
    prev_success="$(jq -r '.lastSuccessAt' "$BACKUP_STATUS_FILE" 2>/dev/null || echo null)"
  else
    prev_failures=0
    prev_success=null
  fi
  case "$prev_failures" in ''|*[!0-9]*) prev_failures=0 ;; esac

  if [ "$ok" = "true" ]; then
    last_success_at="$now"
    consecutive_failures=0
  else
    last_success_at="$prev_success"
    consecutive_failures=$((prev_failures + 1))
  fi

  jq -n \
    --arg lastRunAt "$now" \
    --argjson lastRunOk "$ok" \
    --arg lastSuccessAt "$last_success_at" \
    --argjson consecutiveFailures "$consecutive_failures" \
    --arg lastError "$error_msg" \
    '{
      lastRunAt: $lastRunAt,
      lastRunOk: $lastRunOk,
      lastSuccessAt: (if $lastSuccessAt == "null" then null else $lastSuccessAt end),
      consecutiveFailures: $consecutiveFailures,
      lastError: (if $lastError == "" then null else $lastError end)
    }' > "${BACKUP_STATUS_FILE}.tmp"
  mv "${BACKUP_STATUS_FILE}.tmp" "$BACKUP_STATUS_FILE"
}

run_backup() {
  local ts file err_output
  ts="$(date +%Y%m%d-%H%M%S)"
  file="$BACKUP_DIR/nexamed-${POSTGRES_DB}-${ts}.dump"
  echo "[backup] $(date -Iseconds) bắt đầu sao lưu → $file"
  if err_output="$(pg_dump -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f "$file" 2>&1)"; then
    echo "[backup] $(date -Iseconds) THÀNH CÔNG ($(du -h "$file" | cut -f1))"
    write_status true
  else
    echo "[backup] $(date -Iseconds) THẤT BẠI — kiểm tra log phía trên và dung lượng đĩa còn trống." >&2
    echo "$err_output" >&2
    rm -f "$file"
    write_status false "$(echo "$err_output" | tail -n 1)"
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
