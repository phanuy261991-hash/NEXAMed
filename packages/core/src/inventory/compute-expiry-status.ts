export type ExpiryStatus = 'EXPIRED' | 'EXPIRING_SOON';

/**
 * So `expiryDate` với `todayUtcMs` (mốc 00:00 UTC của "hôm nay" theo giờ Việt Nam — tầng gọi tự
 * dựng bằng `toVietnamDateParts`, hàm này không tự lấy giờ hệ thống) trong ngưỡng `warningDays` —
 * trả `null` nếu còn hạn dùng ngoài ngưỡng (không cần cảnh báo gì). Dùng chung cho "Cảnh báo hạn
 * dùng" (danh sách đã lọc sẵn trong ngưỡng ở tầng repository) và "Tồn kho theo lô" (hiện badge cho
 * đúng lô rơi vào ngưỡng, lô khác không hiện gì) — tránh lặp lại phép tính ngày.
 */
export function computeExpiryStatus(
  expiryDate: Date,
  todayUtcMs: number,
  warningDays: number,
): { status: ExpiryStatus; daysUntilExpiry: number } | null {
  const daysUntilExpiry = Math.round((expiryDate.getTime() - todayUtcMs) / (24 * 60 * 60 * 1000));
  if (daysUntilExpiry > warningDays) return null;
  const status: ExpiryStatus = daysUntilExpiry < 0 ? 'EXPIRED' : 'EXPIRING_SOON';
  return { status, daysUntilExpiry };
}
