import type { BackupStatusSnapshot } from '../ports/backup-status.port';

export type BackupAlertReason = 'NEVER_RUN' | 'LAST_RUN_FAILED' | 'STALE';

export interface BackupAlertState {
  needsAttention: boolean;
  reason: BackupAlertReason | null;
}

export const DEFAULT_BACKUP_STALE_THRESHOLD_HOURS = 30;

/**
 * S6-01 (ADM-04) — hàm thuần đánh giá cảnh báo backup, nhận `snapshot` đã đọc qua
 * `BackupStatusPort` + thời điểm hiện tại (không tự đọc đồng hồ hệ thống, dễ unit test).
 * `staleThresholdHours` mặc định 30 = 1 ngày (lịch chạy hằng ngày) + 6 giờ đệm, tránh báo giả do
 * lệch giờ container/thời điểm actor đăng nhập ngay trước giờ chạy kế tiếp.
 *
 * 3 lý do cảnh báo (đúng 2 tình huống đã chốt ở S6-01: "thất bại rõ ràng" VÀ "trễ hạn/im lặng"):
 * - `NEVER_RUN`: chưa từng có lần sao lưu thành công nào (kể cả trường hợp container `backup` bị
 *   dừng/crash không chạy được lần nào — không có snapshot để so sánh "thất bại" hay "trễ hạn").
 * - `LAST_RUN_FAILED`: lần chạy gần nhất thất bại (dù trước đó từng có lần thành công).
 * - `STALE`: từng có lần thành công nhưng đã quá lâu không có lần thành công mới.
 */
export function evaluateBackupStatus(
  snapshot: BackupStatusSnapshot | null,
  now: Date,
  staleThresholdHours: number = DEFAULT_BACKUP_STALE_THRESHOLD_HOURS,
): BackupAlertState {
  if (!snapshot || !snapshot.lastSuccessAt) {
    return { needsAttention: true, reason: 'NEVER_RUN' };
  }
  if (snapshot.lastRunOk === false) {
    return { needsAttention: true, reason: 'LAST_RUN_FAILED' };
  }
  const hoursSinceSuccess = (now.getTime() - new Date(snapshot.lastSuccessAt).getTime()) / (1000 * 60 * 60);
  if (hoursSinceSuccess > staleThresholdHours) {
    return { needsAttention: true, reason: 'STALE' };
  }
  return { needsAttention: false, reason: null };
}
