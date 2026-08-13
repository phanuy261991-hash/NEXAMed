import { z } from 'zod';

/**
 * Múi giờ hiển thị của phòng khám (trang "Thông tin phòng khám", 2026-08-13) — CHỈ lưu giá trị,
 * CHƯA nối vào logic ngày giờ hệ thống (vẫn hard-code UTC+7 ở `packages/core/src/date/
 * vietnam-day-range.ts` và các nơi khác — xem docs/DECISIONS.md #041). Nguồn sự thật danh sách
 * IANA id hợp lệ — web KHÔNG import mảng này (đặt lại danh sách hiển thị riêng ở `apps/web`, cùng
 * lý do "giới hạn Rollup" như `currency.ts`).
 */
export const TIMEZONE_VALUES = [
  'Asia/Ho_Chi_Minh',
  'Asia/Bangkok',
  'Asia/Singapore',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'UTC',
  'Europe/London',
  'America/New_York',
  'Australia/Sydney',
] as const;

export const timezoneSchema = z.enum(TIMEZONE_VALUES);

export type Timezone = z.infer<typeof timezoneSchema>;
