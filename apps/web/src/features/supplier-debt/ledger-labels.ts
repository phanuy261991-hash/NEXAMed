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

/**
 * Câu "Diễn giải" của một dòng Sổ công nợ (mockup màn 12 của #298): nói dòng này là gì bằng lời, có chữ cho MỌI dòng. Phiếu nhập nhận theo đơn đặt hàng nêu số đơn và đợt nhận;
 * các loại còn lại dùng câu cố định. Lý do/ghi chú của người lập (nếu có) hiện riêng dưới câu này ở bảng, không trộn vào đây.
 */
export function describeLedgerEntry(entry: Pick<SupplierDebtLedgerEntry, 'entryType' | 'purchaseOrderNo' | 'purchaseOrderRound'>): string {
  switch (entry.entryType) {
    case 'PURCHASE':
      return entry.purchaseOrderNo ? `Nhập từ đơn ${entry.purchaseOrderNo}${entry.purchaseOrderRound ? ` (đợt ${entry.purchaseOrderRound})` : ''}` : 'Nhập mua hàng';
    case 'PAYMENT':
      return 'Thanh toán công nợ';
    case 'RETURN':
      return 'Trả hàng nhà cung cấp';
    case 'REFUND_RECEIVED':
      return 'Nhà cung cấp hoàn tiền';
    case 'OPENING_BALANCE':
      return 'Khai nợ đầu kỳ';
    case 'ADJUSTMENT_INCREASE':
      return 'Điều chỉnh tăng công nợ';
    case 'ADJUSTMENT_DECREASE':
      return 'Điều chỉnh giảm công nợ';
    case 'REVERSAL':
      return 'Đảo bút toán';
    case 'LAB_PARTNER':
      return 'Xét nghiệm gửi đối tác';
  }
}
