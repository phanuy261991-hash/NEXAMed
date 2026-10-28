import { useEffect, useState } from 'react';
import type { BusinessHours, DoctorClosingState } from '@nexamed/shared';
import { useScheduleConfigQuery } from '../appointment/appointment.queries';

const CHECK_INTERVAL_MS = 30_000;
const DAY_KEYS: (keyof BusinessHours)[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * GIỜ nhắc đóng ca hôm nay (`HH:mm`), `null` = không nhắc (mockup duyệt 28/10/2026):
 * - có ca đã xếp hôm nay → giờ kết thúc của ca CUỐI cùng;
 * - nghỉ phép cả ngày đã được duyệt, hoặc phòng khám tắt "Nhắc và bắt buộc đóng ca" ở Cấu hình khám → không nhắc;
 * - không có ca nào → giờ đóng cửa phòng khám của thứ hôm nay (như trước đây); ngày phòng khám nghỉ → không nhắc.
 */
export function resolveReminderTime(
  closing: Pick<DoctorClosingState, 'todayClosingTime' | 'todayClosingSource'>,
  businessHours: BusinessHours | null | undefined,
  now: Date,
): string | null {
  if (closing.todayClosingSource === 'LEAVE' || closing.todayClosingSource === 'DISABLED') return null;
  if (closing.todayClosingSource === 'SHIFT' && closing.todayClosingTime) return closing.todayClosingTime;
  return businessHours?.[DAY_KEYS[now.getDay()]!]?.close ?? null;
}

/** Đã tới/qua giờ `hhmm` (giờ máy trạm, cùng ngày với `now`) chưa. */
export function isAtOrPastTime(now: Date, hhmm: string): boolean {
  const [hours, minutes] = hhmm.split(':').map(Number);
  const at = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0, 0);
  return now >= at;
}

/**
 * Nhắc đóng ca khi hết giờ làm việc — chỉ để HIỆN CHIP trên thanh đỉnh, KHÔNG tự bật hộp thoại (chủ dự án chốt 28/10/2026): bác sĩ đăng
 * nhập/tải lại sau giờ hoặc đồng hồ vừa chạm giờ giữa lúc đang khám đều chỉ thấy chip, khám tiếp bình thường, xong tự bấm chip để đóng ca.
 * Client so `Date.now()` mỗi 30 giây (không WebSocket, cùng khuôn cảnh báo "Không đến" #093), không chốt cờ nên sang ngày mới tự tắt.
 *
 * Giờ nhắc lấy từ ca đã xếp của bác sĩ (`closing`, từ `GET /doctor-availability/me/closing-state`), không có ca thì giờ đóng cửa phòng khám qua
 * `useScheduleConfigQuery()` (tự-phục vụ, quyền `appointment.read` — bác sĩ luôn có; KHÔNG dùng `useClinicSettingsQuery()`, #030).
 * `closing` chưa tải xong thì chưa nhắc, tránh chip nháy lên rồi tắt khi biết hôm nay bác sĩ chỉ làm ca sáng.
 */
export function useClosingTimeReminder(enabled: boolean, closing: DoctorClosingState | undefined): boolean {
  // Chỉ bác sĩ chưa đóng ca mới cần giờ làm việc — các vai trò khác không gọi (tránh 403 ở vai trò không có `appointment.read`).
  const scheduleConfigQuery = useScheduleConfigQuery({ enabled });
  const [pastClosingTime, setPastClosingTime] = useState(false);
  const businessHours = scheduleConfigQuery.data?.businessHours;

  useEffect(() => {
    if (!enabled || !closing) {
      setPastClosingTime(false);
      return;
    }
    const closingState = closing;

    function check() {
      const now = new Date();
      const reminderTime = resolveReminderTime(closingState, businessHours, now);
      setPastClosingTime(reminderTime !== null && isAtOrPastTime(now, reminderTime));
    }

    check();
    const timer = setInterval(check, CHECK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [enabled, closing, businessHours]);

  return pastClosingTime;
}
