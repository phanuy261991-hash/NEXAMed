import { z } from 'zod';

/**
 * Đơn vị tiền tệ hiển thị của phòng khám (trang "Thông tin phòng khám", 2026-08-13) — CHỈ dùng để
 * validate/lưu `tenant.currency`, CHƯA có nơi nào trong hệ thống dùng để tính/hiển thị tiền (viện
 * phí là v2+, xem docs/DECISIONS.md #041). Nguồn sự thật danh sách mã hợp lệ — web KHÔNG import
 * mảng này (đặt lại danh sách hiển thị riêng ở `apps/web`, xem lý do "giới hạn Rollup" ở
 * docs/DECISIONS.md #032/#036: hằng số giá trị thuần từ packages/shared từng không import được
 * vào apps/web qua vite build).
 */
export const CURRENCY_CODES = ['VND', 'USD', 'EUR', 'JPY', 'KRW', 'CNY', 'GBP', 'AUD', 'THB', 'SGD'] as const;

export const currencyCodeSchema = z.enum(CURRENCY_CODES);

export type CurrencyCode = z.infer<typeof currencyCodeSchema>;
