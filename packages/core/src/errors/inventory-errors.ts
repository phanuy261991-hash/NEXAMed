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

// ============ Kho Thuốc GĐ4, "Phiếu xuất kho mở rộng" (docs/DECISIONS.md #170) ============

/** Sửa/Duyệt/Từ chối một phiếu xuất kho (loại Nháp→Duyệt: Xuất dùng nội bộ/Xuất trả NCC/Xuất huỷ)
 * không (còn) ở trạng thái Nháp. */
export class StockIssueNotDraftError extends DomainError {
  readonly code = 'STOCK_ISSUE_NOT_DRAFT';

  constructor() {
    super('Phiếu xuất kho này không còn ở trạng thái Nháp.');
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

// ============ Kho Thuốc GĐ4 (Kiểm kê/Điều chuyển/Mở rộng Nhập-Xuất kho/Báo cáo N-X-T, docs/DECISIONS.md #170) ============

/** Sửa/Duyệt/Từ chối một phiếu kiểm kê không (còn) ở trạng thái Nháp. */
export class StockCountNotDraftError extends DomainError {
  readonly code = 'STOCK_COUNT_NOT_DRAFT';

  constructor() {
    super('Phiếu kiểm kê này không còn ở trạng thái Nháp.');
  }
}

/** Duyệt phiếu kiểm kê có dòng dư/thiếu (đọc tồn kho SỐNG lúc Duyệt) mà không kèm lý do — rà soát
 * lỗ hổng quy trình 22/09/2026 (chủ dự án phát hiện: trước đây Duyệt tự động sửa tồn kho không cần
 * giải trình gì). Phiếu khớp hoàn toàn (không dòng nào dư/thiếu) thì không bắt buộc. */
export class StockCountApprovalReasonRequiredError extends DomainError {
  readonly code = 'STOCK_COUNT_APPROVAL_REASON_REQUIRED';

  constructor() {
    super('Phiếu có dòng dư/thiếu — phải nhập lý do trước khi Duyệt.');
  }
}

// ============ Kho Thuốc GĐ4, phần "Điều chuyển kho" (docs/DECISIONS.md #170) ============

/** Sửa/Duyệt xuất/Từ chối một phiếu điều chuyển kho không (còn) ở trạng thái Nháp. */
export class StockTransferNotDraftError extends DomainError {
  readonly code = 'STOCK_TRANSFER_NOT_DRAFT';

  constructor() {
    super('Phiếu điều chuyển kho này không còn ở trạng thái Nháp.');
  }
}

/** Xác nhận nhận hàng một phiếu không (còn) ở trạng thái Đang vận chuyển. */
export class StockTransferNotInTransitError extends DomainError {
  readonly code = 'STOCK_TRANSFER_NOT_IN_TRANSIT';

  constructor() {
    super('Phiếu điều chuyển kho này không ở trạng thái Đang vận chuyển.');
  }
}

/** Duyệt xuất (DRAFT→IN_TRANSIT) — không đủ tồn kho tại kho NGUỒN theo lô/mặt hàng đã chọn để xuất
 * đúng số lượng đã khai lúc lập phiếu. */
export class StockTransferInsufficientStockError extends DomainError {
  readonly code = 'STOCK_TRANSFER_INSUFFICIENT_STOCK';

  constructor(drugName: string) {
    super(`Không đủ tồn kho tại kho nguồn để chuyển "${drugName}".`);
  }
}

/** Xác nhận nhận hàng — nhập số lượng thực nhận CAO HƠN số lượng đã xuất. Chặn CỨNG (kế hoạch
 * #170 mục 8: kho đích có thể nhận ít hơn số đã xuất, không bao giờ được nhận nhiều hơn — nếu dư
 * thật thì xử lý bằng Kiểm kê riêng, không lẫn vào Điều chuyển). Cũng có CHECK ở tầng DB, đây là
 * lớp kiểm tra sớm hơn, thông báo rõ đúng mặt hàng nào vi phạm. */
export class StockTransferReceivedExceedsShippedError extends DomainError {
  readonly code = 'STOCK_TRANSFER_RECEIVED_EXCEEDS_SHIPPED';

  constructor(drugName: string) {
    super(`"${drugName}" — số lượng thực nhận không được vượt quá số lượng đã xuất.`);
  }
}

/** Xác nhận nhận hàng — số lượng thực nhận THẤP hơn số lượng đã xuất nhưng thiếu ghi chú lý do
 * chênh lệch (bắt buộc, kế hoạch #170 mục 8 — "minh bạch & kiểm soát thất thoát"). */
export class StockTransferVarianceNoteRequiredError extends DomainError {
  readonly code = 'STOCK_TRANSFER_VARIANCE_NOTE_REQUIRED';

  constructor(drugName: string) {
    super(`"${drugName}" — nhận ít hơn số đã xuất, phải nhập ghi chú chênh lệch.`);
  }
}
