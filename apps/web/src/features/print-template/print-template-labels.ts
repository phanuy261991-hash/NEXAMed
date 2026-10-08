import type { PrintPaperSize } from '@nexamed/shared';

/**
 * Nhãn ngắn của khổ giấy (chip, danh sách) — khai báo ở web vì `apps/web` KHÔNG import được GIÁ TRỊ từ `@nexamed/shared`
 * (lỗi Rollup khi build, xem docs/DECISIONS.md #032/#211). Nhãn đầy đủ + kích thước đi qua API (`catalog.papers`).
 */
export const PAPER_SHORT_LABEL: Record<PrintPaperSize, string> = {
  A4: 'A4',
  A5: 'A5',
  A5_LANDSCAPE: 'A5 ngang',
  K80: 'K80',
  LABEL_35X22: 'Tem 35×22',
  LABEL_50X30: 'Tem 50×30',
};

/** Mức thu/phóng mặc định của xem trước theo khổ giấy (%): tờ A4 thu nhỏ để vừa khung, giấy cuộn K80 giữ nguyên. */
export const DEFAULT_PREVIEW_ZOOM: Record<PrintPaperSize, number> = { A4: 60, A5: 75, A5_LANDSCAPE: 60, K80: 100, LABEL_35X22: 300, LABEL_50X30: 220 };
