export type DayPeriod = 'morning' | 'noon' | 'afternoon' | 'evening';

/**
 * Khung giờ trong ngày theo GIỜ VIỆT NAM (UTC+7 cố định, đúng quy ước hiển thị của dự án) nên máy đặt sai múi giờ vẫn
 * đúng. Sáng 05:00–10:59, trưa 11:00–12:59, chiều 13:00–17:59, tối 18:00–04:59.
 */
export function getVietnamDayPeriod(now: Date = new Date()): DayPeriod {
  const hour = (now.getUTCHours() + 7) % 24;
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 13) return 'noon';
  if (hour >= 13 && hour < 18) return 'afternoon';
  return 'evening';
}

const GREETING_BY_PERIOD: Record<DayPeriod, string> = {
  morning: 'Xin chào, Buổi sáng !!!',
  noon: 'Xin chào, Buổi trưa !!!',
  afternoon: 'Xin chào, Buổi chiều !!!',
  evening: 'Xin chào, Buổi tối !!!',
};

/** Câu chào theo khung giờ: "Xin chào, Buổi sáng/trưa/chiều/tối !!!". */
export function getVietnamGreeting(now: Date = new Date()): string {
  return GREETING_BY_PERIOD[getVietnamDayPeriod(now)];
}
