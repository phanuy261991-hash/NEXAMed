const VIETNAM_UTC_OFFSET_MINUTES = 7 * 60;

/**
 * "Ca sáng"/"Ca chiều"/"Ca tối" — snapshot lưu vào `cashier_shift.shift_label` lúc Mở ca, tính
 * theo giờ Việt Nam (cùng kỹ thuật `vietnamDayRange()`/`getVietnamDateString()`, KHÔNG dùng giờ
 * UTC server thô). KHÔNG liên quan danh mục `work_shift` (mẫu ca làm việc nhân viên, #101) — đây
 * chỉ là nhãn hiển thị suy ra từ thời điểm mở ca, không tra danh mục nào.
 */
export function deriveShiftLabel(openedAtUtc: Date): string {
  const shifted = new Date(openedAtUtc.getTime() + VIETNAM_UTC_OFFSET_MINUTES * 60_000);
  const hour = shifted.getUTCHours();
  if (hour >= 5 && hour < 12) return 'Ca sáng';
  if (hour >= 12 && hour < 18) return 'Ca chiều';
  return 'Ca tối';
}
