import { DomainError } from './domain-error';

/** Sửa/Duyệt/Từ chối một phiếu nhập kho không (còn) ở trạng thái Nháp. */
export class StockReceiptNotDraftError extends DomainError {
  readonly code = 'STOCK_RECEIPT_NOT_DRAFT';

  constructor() {
    super('Phiếu nhập kho này không còn ở trạng thái Nháp.');
  }
}

/** Huỷ phiếu — phiếu không (còn) ở trạng thái Đã duyệt, hoặc tồn kho của (ít nhất) 1 dòng đã bị
 * dùng bớt nên không đủ để trừ ngược lại. */
export class StockReceiptVoidNotAllowedError extends DomainError {
  readonly code = 'STOCK_RECEIPT_VOID_NOT_ALLOWED';

  constructor(message = 'Không thể huỷ phiếu này — tồn kho của một hoặc nhiều mặt hàng trong phiếu đã bị dùng bớt.') {
    super(message);
  }
}

// ============ Kho Thuốc GĐ3 (Xuất kho theo đơn + FEFO + tiền thuốc, docs/DECISIONS.md #163) ============

/** Phát VƯỢT số lượng còn lại của một dòng thuốc trong đơn — chặn cứng (422), khác PRE-02/03 lâm
 * sàng chỉ cảnh báo mềm, vì đây là tiền + tồn kho thật (#146 điểm 4 phiên chốt kế hoạch GĐ3). */
export class StockIssueExceedsPrescribedQuantityError extends DomainError {
  readonly code = 'STOCK_ISSUE_EXCEEDS_PRESCRIBED_QUANTITY';

  constructor(drugName: string, remaining: number) {
    super(`"${drugName}" chỉ còn ${remaining} đơn vị chưa phát theo đơn — không thể phát vượt số lượng này.`);
  }
}

/** Dòng OTC bán thêm (`prescriptionItemId=null`) nhưng thuốc đó vẫn yêu cầu kê đơn — chỉ hàng
 * `isPrescriptionOnly=false` mới thêm tự do được (#146 điểm 7). */
export class StockIssueOtcRequiresNonPrescriptionDrugError extends DomainError {
  readonly code = 'STOCK_ISSUE_OTC_REQUIRES_NON_PRESCRIPTION_DRUG';

  constructor(drugName: string) {
    super(`"${drugName}" là thuốc kê đơn — không thể thêm tự do ngoài đơn thuốc.`);
  }
}

/** Không đủ tồn kho để phát (mọi lô cộng lại vẫn thiếu, hoặc lô cụ thể được chọn không đủ). */
export class StockIssueInsufficientStockError extends DomainError {
  readonly code = 'STOCK_ISSUE_INSUFFICIENT_STOCK';

  constructor(drugName: string) {
    super(`Không đủ tồn kho để phát "${drugName}".`);
  }
}

/** Huỷ phiếu xuất — phiếu không (còn) ở trạng thái Đã phát, hoặc hoá đơn liên quan đã được thu
 * tiền (phải hoàn tiền qua `invoice.refund()`, không void ở đây — #146 giữ đúng ranh giới đã có
 * giữa "Đánh dấu chưa thu" và "Hoàn tiền"). */
export class StockIssueVoidNotAllowedError extends DomainError {
  readonly code = 'STOCK_ISSUE_VOID_NOT_ALLOWED';

  constructor(message = 'Không thể huỷ phiếu xuất này — hoá đơn liên quan đã được thu tiền, phải hoàn tiền thay vì huỷ phiếu.') {
    super(message);
  }
}
