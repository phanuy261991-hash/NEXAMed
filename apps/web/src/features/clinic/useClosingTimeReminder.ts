import { useEffect, useState } from 'react';
import type { BusinessHours } from '@nexamed/shared';
import { useScheduleConfigQuery } from '../appointment/appointment.queries';

const CHECK_INTERVAL_MS = 30_000;
const DAY_KEYS: (keyof BusinessHours)[] = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * "Đóng ca hôm nay" Trường hợp 2 ("Hết giờ làm việc") — client tự phát hiện đã qua giờ đóng cửa
 * phòng khám hôm nay, so `Date.now()` với `ClinicSettings.businessHours` mỗi 30s (không có
 * push/WebSocket, cùng pattern cảnh báo "Không đến" #093). Dùng `useScheduleConfigQuery()` có sẵn
 * (self-serve, quyền `appointment.read` — bác sĩ luôn có) thay vì `useClinicSettingsQuery()`
 * (`clinic_config.read`, chỉ `clinic_admin` — đúng lớp lỗi đã gặp nhiều lần, #030).
 *
 * CHỈ NHẮC — không tự đóng ca (đã hỏi và chốt với chủ dự án): trả về `true` một lần khi vượt
 * ngưỡng trong phiên hiện tại và giữ nguyên `true` (không tự reset), để caller hiện chip/dialog
 * nhắc nhở PERSISTENT — không lặp lại popup mỗi 30s.
 */
export function useClosingTimeReminder(enabled: boolean): boolean {
  const scheduleConfigQuery = useScheduleConfigQuery();
  const [pastClosingTime, setPastClosingTime] = useState(false);

  useEffect(() => {
    if (!enabled || pastClosingTime) return;
    const businessHours = scheduleConfigQuery.data?.businessHours;
    if (!businessHours) return;

    function check() {
      const now = new Date();
      const dayKey = DAY_KEYS[now.getDay()]!;
      const hours = businessHours![dayKey];
      if (!hours) return;
      const [closeH, closeM] = hours.close.split(':').map(Number);
      const closeAt = new Date(now.getFullYear(), now.getMonth(), now.getDate(), closeH, closeM, 0, 0);
      if (now >= closeAt) {
        setPastClosingTime(true);
      }
    }

    check();
    const timer = setInterval(check, CHECK_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [enabled, pastClosingTime, scheduleConfigQuery.data]);

  return pastClosingTime;
}
