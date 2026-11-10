import type { SupplierDebtLedgerEntry } from '@nexamed/shared';

/**
 * Nhãn tiếng Việt của loại bút toán Sổ công nợ nhà cung cấp (docs/DECISIONS.md #292), dùng cho bảng trên màn hình và bản in. Khớp `SUPPLIER_DEBT_ENTRY_TYPE_LABELS` ở `packages/shared` (máy chủ dùng
 * bản đó cho Excel) — web chỉ import KIỂU từ `@nexamed/shared` (bản dist là CommonJS) nên giữ một bản riêng ở đây; thêm loại bút toán mới thì sửa cả hai.
 */
export const ENTRY_TYPE_LABEL: Record<SupplierDebtLedgerEntry['entryType'], string> = {
  OPENING_BALANCE: 'Nợ đầu kỳ',
  PURCHASE: 'Phát sinh nợ',
  PAYMENT: 'Thanh toán',
  RETURN: 'Trả hàng',
  REFUND_RECEIVED: 'NCC hoàn tiền',
  ADJUSTMENT_INCREASE: 'Điều chỉnh tăng',
  ADJUSTMENT_DECREASE: 'Điều chỉnh giảm',
  REVERSAL: 'Bút toán đảo',
  LAB_PARTNER: 'Xét nghiệm đối tác',
};
