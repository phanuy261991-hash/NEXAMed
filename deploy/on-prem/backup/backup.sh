#!/usr/bin/env bash
# Sao lưu Postgres hằng ngày cho bản cài on-prem (S4-05, hạ tầng lịch tự động — diễn tập phục hồi
# đầy đủ ở S6-02, xem docs/Deploy.md).
# Chạy `pg_dump` custom format (-Fc, hỗ trợ `pg_restore` chọn lọc bảng/song song) ra $BACKUP_DIR
# (bind-mount thư mục ngoài container — nên trỏ ra ổ đĩa khác/ổ ngoài theo đúng khuyến nghị
# `.claude/docs/project-structure.md`: "Backup ghi ra thư mục cấu hình được").
#
# Sao lưu THƯ MỤC ẢNH (docs/DECISIONS.md #216): ảnh đính kèm kết quả cận lâm sàng, ảnh đại diện bệnh nhân, logo nằm ở volume `api_storage` (không nằm trong DB nên
# `pg_dump` không giữ được). Mỗi lần chạy, TRƯỚC `pg_dump`, đồng bộ thư mục đó sang "$BACKUP_DIR/storage" bằng `cp -a -u` (chỉ chép file MỚI/đổi — ảnh không bao giờ bị sửa
# hay xoá nên là bản sao tăng dần, không nhân bản toàn bộ mỗi ngày; KHÔNG dọn theo BACKUP_RETENTION_DAYS vì đó là kho dữ liệu, không phải bản chụp theo ngày). Chép ảnh
# trước DB để mọi ảnh mà bản dump DB tham chiếu chắc chắn đã có trong bản sao. Ảnh KHÔNG bị nén/đổi gì (giữ nguyên bản gốc).
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
CFG_ENABLED=true
CFG_HOUR_VN=9
CFG_RETENTION=14
BACKUP_STATUS_FILE="${BACKUP_STATUS_FILE:-/status/backup-status.json}"
STATUS_DIR="$(dirname "$BACKUP_STATUS_FILE")"
# Cấu hình sao lưu chỉnh được từ giao diện (docs/DECISIONS.md #217): API ghi `backup-config.json` + cờ `backup-run-now` vào CÙNG volume với file trạng thái; script đọc lại mỗi
# vòng lặp (không cần khởi động lại container). Biến BACKUP_HOUR (UTC) / BACKUP_RETENTION_DAYS trong `.env` CHỈ còn là giá trị khởi tạo cho lần chạy đầu tiên.
BACKUP_CONFIG_FILE="${BACKUP_CONFIG_FILE:-$STATUS_DIR/backup-config.json}"
BACKUP_RUN_NOW_FILE="${BACKUP_RUN_NOW_FILE:-$STATUS_DIR/backup-run-now}"
BACKUP_POLL_SECONDS="${BACKUP_POLL_SECONDS:-10}"
VN_UTC_OFFSET=7
STORAGE_DIR="${STORAGE_DIR:-/data/storage}"
STORAGE_BACKUP_DIR="${STORAGE_BACKUP_DIR:-$BACKUP_DIR/storage}"

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

# Đồng bộ thư mục ảnh sang bản sao tăng dần. Trả 0 nếu xong, khác 0 kèm thông báo lỗi ở stderr.
backup_storage() {
  if [ ! -d "$STORAGE_DIR" ]; then
    echo "không thấy thư mục ảnh $STORAGE_DIR (đã gắn volume api_storage vào dịch vụ backup chưa?)" >&2
    return 1
  fi
  mkdir -p "$STORAGE_BACKUP_DIR"
  cp -a -u "$STORAGE_DIR"/. "$STORAGE_BACKUP_DIR"/
}

run_backup() {
  local ts file err_output storage_err=""
  ts="$(date +%Y%m%d-%H%M%S)"
  echo "[backup] $(date -Iseconds) đồng bộ thư mục ảnh → $STORAGE_BACKUP_DIR"
  if storage_err="$(backup_storage 2>&1)"; then
    echo "[backup] $(date -Iseconds) ảnh: xong ($(find "$STORAGE_BACKUP_DIR" -type f 2>/dev/null | wc -l) file, $(du -sh "$STORAGE_BACKUP_DIR" 2>/dev/null | cut -f1))"
  else
    echo "[backup] $(date -Iseconds) ảnh: THẤT BẠI — $storage_err" >&2
  fi
  file="$BACKUP_DIR/nexamed-${POSTGRES_DB}-${ts}.dump"
  echo "[backup] $(date -Iseconds) bắt đầu sao lưu → $file"
  if err_output="$(pg_dump -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc -f "$file" 2>&1)"; then
    echo "[backup] $(date -Iseconds) THÀNH CÔNG ($(du -h "$file" | cut -f1))"
    if [ -n "$storage_err" ]; then
      # DB đã lưu được nhưng ảnh thì không — vẫn báo THẤT BẠI để banner cảnh báo hiện, vì bản sao lưu này không đủ để khôi phục ảnh.
      write_status false "Sao lưu thư mục ảnh thất bại: $(echo "$storage_err" | tail -n 1)"
      return 1
    fi
    write_status true
  else
    echo "[backup] $(date -Iseconds) THẤT BẠI — kiểm tra log phía trên và dung lượng đĩa còn trống." >&2
    echo "$err_output" >&2
    rm -f "$file"
    write_status false "$(echo "$err_output" | tail -n 1)"
    return 1
  fi
  # Dọn bản cũ quá hạn giữ (mặc định 14 ngày) — tránh đầy đĩa PC phòng khám theo thời gian.
  find "$BACKUP_DIR" -maxdepth 1 -name 'nexamed-*.dump' -mtime "+${CFG_RETENTION}" -print -delete
}

# Ghi cấu hình khởi tạo từ `.env` nếu chưa có file (lần chạy đầu tiên sau khi cài/nâng cấp) để giao diện luôn đọc được giá trị thật.
ensure_config() {
  [ -f "$BACKUP_CONFIG_FILE" ] && return 0
  local hour_vn=$(( (${BACKUP_HOUR:-2} + VN_UTC_OFFSET) % 24 ))
  jq -n --argjson hourVn "$hour_vn" --argjson retentionDays "$BACKUP_RETENTION_DAYS" '{enabled: true, hourVn: $hourVn, retentionDays: $retentionDays}' > "${BACKUP_CONFIG_FILE}.tmp"
  mv "${BACKUP_CONFIG_FILE}.tmp" "$BACKUP_CONFIG_FILE"
}

# Đọc lại cấu hình; giá trị sai/thiếu giữ nguyên giá trị đang dùng (không để file hỏng làm dừng sao lưu).
read_config() {
  local enabled hour retention
  enabled="$(jq -r '.enabled' "$BACKUP_CONFIG_FILE" 2>/dev/null || echo "")"
  hour="$(jq -r '.hourVn' "$BACKUP_CONFIG_FILE" 2>/dev/null || echo "")"
  retention="$(jq -r '.retentionDays' "$BACKUP_CONFIG_FILE" 2>/dev/null || echo "")"
  case "$enabled" in true|false) CFG_ENABLED="$enabled" ;; esac
  case "$hour" in ''|*[!0-9]*) ;; *) [ "$hour" -le 23 ] && CFG_HOUR_VN="$hour" ;; esac
  case "$retention" in ''|*[!0-9]*) ;; *) [ "$retention" -ge 1 ] && CFG_RETENTION="$retention" ;; esac
  return 0
}

# Lần chạy tự động kế tiếp (epoch): giờ cấu hình theo giờ VN → UTC (container chạy UTC).
next_run_epoch() {
  local hour_utc now next
  hour_utc=$(( (CFG_HOUR_VN - VN_UTC_OFFSET + 24) % 24 ))
  now=$(date +%s)
  next=$(date -d "today ${hour_utc}:00" +%s)
  if [ "$next" -le "$now" ]; then
    next=$(date -d "tomorrow ${hour_utc}:00" +%s)
  fi
  echo "$next"
}

echo "[backup] Chờ Postgres sẵn sàng..."
until pg_isready -h "$POSTGRES_HOST" -U "$POSTGRES_USER" >/dev/null 2>&1; do
  sleep 2
done

ensure_config
read_config
echo "[backup] Sẵn sàng — cấu hình: ${CFG_ENABLED/true/bật}/${CFG_HOUR_VN}h giờ VN/giữ ${CFG_RETENTION} ngày. Sao lưu ngay lần đầu, sau đó theo lịch hoặc khi có yêu cầu \"Sao lưu ngay\" từ giao diện."
run_backup || true

next=$(next_run_epoch)
echo "[backup] Lần tự động kế tiếp: $(date -d "@$next" -Iseconds)."
while true; do
  sleep "$BACKUP_POLL_SECONDS"
  prev_hour="$CFG_HOUR_VN"
  prev_enabled="$CFG_ENABLED"
  read_config
  # Đổi giờ hoặc bật lại → tính lại mốc kế tiếp (tránh chạy bù ngay một mốc cũ đã trôi qua).
  if [ "$CFG_HOUR_VN" != "$prev_hour" ] || { [ "$CFG_ENABLED" = "true" ] && [ "$prev_enabled" = "false" ]; }; then
    next=$(next_run_epoch)
    echo "[backup] Cấu hình đổi — lần tự động kế tiếp: $(date -d "@$next" -Iseconds)."
  fi
  if [ -f "$BACKUP_RUN_NOW_FILE" ]; then
    rm -f "$BACKUP_RUN_NOW_FILE"
    echo "[backup] $(date -Iseconds) có yêu cầu \"Sao lưu ngay\" từ giao diện."
    run_backup || true
    continue
  fi
  if [ "$CFG_ENABLED" = "true" ] && [ "$(date +%s)" -ge "$next" ]; then
    run_backup || true
    next=$(next_run_epoch)
    echo "[backup] Lần tự động kế tiếp: $(date -d "@$next" -Iseconds)."
  fi
done
