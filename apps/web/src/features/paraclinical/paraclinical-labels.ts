import type { TechnicalServiceKind, TechnicalServiceResultType } from '@nexamed/shared';

/**
 * Nhãn/mặc định cục bộ của web cho Cận lâm sàng (docs/DECISIONS.md #212). `apps/web` KHÔNG import được GIÁ TRỊ từ
 * `@nexamed/shared` (chỉ `import type` — Vite/Rollup báo "does not provide an export", xem bài học ở #211) nên các hằng
 * này lặp lại bản ở `packages/shared/src/technical-service.ts`; `satisfies Record<Kind, ...>` bắt lỗi lệch khoá khi
 * thêm loại mới ở shared (typecheck fail).
 */
export const TECHNICAL_SERVICE_KIND_LABELS = {
  LAB: 'Xét nghiệm',
  IMAGING: 'Chẩn đoán hình ảnh',
  FUNCTIONAL: 'Thăm dò chức năng',
} as const satisfies Record<TechnicalServiceKind, string>;

export const DEFAULT_RESULT_TYPE_BY_KIND = {
  LAB: 'INDICATORS',
  IMAGING: 'NARRATIVE',
  FUNCTIONAL: 'BOTH',
} as const satisfies Record<TechnicalServiceKind, TechnicalServiceResultType>;
