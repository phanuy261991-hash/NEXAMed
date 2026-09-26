import { z } from 'zod';
import { paymentMethodSchema } from './billing';
import { cashVoucherStatusSchema } from './cash-book';

/**
 * "Công nợ nhà cung cấp" (docs/DECISIONS.md #180/#182, mở rộng phạm vi v1) — module `supplier-debt`.
 * Phần A "Nền sổ công nợ": sổ `SupplierDebtEntry` append-only (nguồn sự thật) + `SupplierDebtAccount`
 * (snapshot `balance`, dương = phòng khám còn nợ NCC, âm = NCC đang nợ lại). Phần B "Thanh toán"
 * thêm `POST .../payment` (Thanh toán công nợ trên TỔNG nợ, không chọn từng phiếu — FIFO ngầm) +
 * `GET /supplier-debt/payments` (trang "Phiếu thanh toán NCC"). Phần C "Trả hàng NCC" thêm đường ghi
 * RETURN (Duyệt phiếu xuất trả NCC, `apps/api/src/modules/inventory/`) + `POST .../refund` ("Thu
 * tiền NCC hoàn lại", REFUND_RECEIVED). ADJUSTMENT_INCREASE/ADJUSTMENT_DECREASE khai sẵn enum cho
 * Phần D (REVERSAL đã có đường ghi từ Phần A, huỷ phiếu chi).
 */

export const supplierDebtEntryTypeSchema = z.enum([
  'OPENING_BALANCE',
  'PURCHASE',
  'PAYMENT',
  'RETURN',
  'REFUND_RECEIVED',
  'ADJUSTMENT_INCREASE',
  'ADJUSTMENT_DECREASE',
  'REVERSAL',
]);
export type SupplierDebtEntryType = z.infer<typeof supplierDebtEntryTypeSchema>;

export const supplierDebtItemStatusSchema = z.enum(['UNPAID', 'PARTIALLY_PAID', 'FULLY_PAID']);
export type SupplierDebtItemStatus = z.infer<typeof supplierDebtItemStatusSchema>;

/** `POST /supplier-debt/:supplierId/opening-balance` — chỉ gọi được khi NCC CHƯA có bút toán nào
 * (Q7, kế hoạch mục 0). `amount` cho phép ÂM (Q8 — NCC đã nợ lại phòng khám từ trước khi dùng phần mềm). */
export const recordSupplierDebtOpeningBalanceRequestSchema = z.object({
  amount: z.number().int().refine((v) => v !== 0, 'Số nợ đầu kỳ phải khác 0.'),
  /** `yyyy-mm-dd` hoặc ISO — ngày tính đến (biên bản đối chiếu). */
  occurredAt: z.string().min(1, 'Phải nhập ngày tính đến.'),
  note: z.string().nullable().optional(),
});
export type RecordSupplierDebtOpeningBalanceRequest = z.infer<typeof recordSupplierDebtOpeningBalanceRequestSchema>;

/** 1 dòng ở trang "Công nợ nhà cung cấp" (danh sách mọi NCC) + cột "Còn nợ" ở `/suppliers` + dải
 * metric đầu trang chi tiết NCC — CÙNG 1 hình dạng cho cả 3 nơi dùng, tránh 3 kiểu tính khác nhau. */
export const supplierDebtSummarySchema = z.object({
  supplierId: z.string().uuid(),
  /** Tổng nợ đầu kỳ (0 nếu chưa khai / khai = 0). */
  openingBalanceAmount: z.number().int(),
  /** Tổng PURCHASE đã duyệt (không tính phiếu đã huỷ — REVERSAL tự trừ ra vì tính trực tiếp từ SUM
   * amountChange theo entryType, không phải allocate). */
  totalPurchase: z.number().int(),
  /** Tổng |PAYMENT| đã ghi sổ (chỉ phiếu chi ĐÃ POSTED — Chờ duyệt chưa ghi sổ, xem `pendingApprovalAmount`). */
  totalPaid: z.number().int(),
  /** Tổng |RETURN| + |ADJUSTMENT_DECREASE| − ADJUSTMENT_INCREASE (Phần A luôn 0 — chưa có đường ghi). */
  totalReturnAndAdjustment: z.number().int(),
  /** Dương = còn nợ NCC; âm = NCC đang nợ lại. */
  balance: z.number().int(),
  /** Tổng phiếu chi gắn NCC đang `PENDING_APPROVAL` — CHƯA trừ vào `balance` (chỉ trừ khi Duyệt). */
  pendingApprovalAmount: z.number().int(),
  /** NCC chưa từng có bút toán nào — hiện/ẩn nút "Khai nợ đầu kỳ" (Q7). */
  canRecordOpeningBalance: z.boolean(),
  /** Phần D — số Phiếu điều chỉnh/Đề nghị huỷ đang `PENDING_APPROVAL` của NCC này (gộp vào badge
   * sidebar/banner "chờ duyệt" cùng `pendingApprovalAmount`). */
  pendingAdjustmentCount: z.number().int(),
  /** Phần D, mục 4.2.6 — `false` khi `SUM(amountChange)` lệch với `balance` snapshot (lỗi hệ thống,
   * không do người dùng) — web hiện banner đỏ, chặn Thanh toán/Thu tiền hoàn lại tới khi xử lý. */
  balanceIntegrityOk: z.boolean(),
  /** Phần E — mốc đối chiếu đã CHỐT gần nhất (`yyyy-mm-dd`), `null` nếu chưa từng chốt. Chứng từ có
   * `occurredAt` ≤ mốc này chỉ Huỷ/Điều chỉnh được bởi người có `supplier_debt.unlock`. */
  lockedAsOfDate: z.string().nullable(),
});
export type SupplierDebtSummary = z.infer<typeof supplierDebtSummarySchema>;

export const listSupplierDebtSummariesResponseSchema = z.object({ items: z.array(supplierDebtSummarySchema) });
export type ListSupplierDebtSummariesResponse = z.infer<typeof listSupplierDebtSummariesResponseSchema>;

/** Tab "Sổ công nợ" — 1 dòng/bút toán, sắp CŨ→MỚI theo thứ tự ghi sổ (đúng khuôn Sổ quỹ). */
export const supplierDebtLedgerEntrySchema = z.object({
  id: z.string().uuid(),
  entryType: supplierDebtEntryTypeSchema,
  /** Có dấu — đồng. */
  amountChange: z.number().int(),
  balanceAfter: z.number().int(),
  /** Ngày chứng từ (hiển thị, có thể lùi ngày). */
  occurredAt: z.string(),
  /** Thời điểm ghi sổ thật — dùng làm cột phụ "Ghi sổ lúc" (đúng mockup, phân biệt với `occurredAt`). */
  createdAt: z.string(),
  stockReceiptId: z.string().uuid().nullable(),
  stockReceiptNo: z.string().nullable(),
  /** "Công nợ nhà cung cấp" Phần C — nguồn RETURN (phiếu xuất trả NCC). `stockIssueNo` luôn `null`
   * ở API (đúng lý do `stockReceiptNo`) — web tự ghép qua `GET /inventory/issues?supplierId=`. */
  stockIssueId: z.string().uuid().nullable(),
  stockIssueNo: z.string().nullable(),
  cashVoucherId: z.string().uuid().nullable(),
  cashVoucherNo: z.string().nullable(),
  reversalOfId: z.string().uuid().nullable(),
  /** `true` nếu bút toán này ĐÃ bị 1 dòng REVERSAL khác đảo — web gạch ngang dòng này. */
  reversed: z.boolean(),
  note: z.string().nullable(),
  createdByName: z.string(),
});
export type SupplierDebtLedgerEntry = z.infer<typeof supplierDebtLedgerEntrySchema>;

export const listSupplierDebtLedgerQuerySchema = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});
export type ListSupplierDebtLedgerQuery = z.infer<typeof listSupplierDebtLedgerQuerySchema>;

export const listSupplierDebtLedgerResponseSchema = z.object({ items: z.array(supplierDebtLedgerEntrySchema) });
export type ListSupplierDebtLedgerResponse = z.infer<typeof listSupplierDebtLedgerResponseSchema>;

/** Tab "Phiếu nhập" — mỗi khoản NỢ (PURCHASE, hoặc dòng ảo "Nợ đầu kỳ") kèm trạng thái đã
 * trả/còn nợ, tính bằng `allocateSupplierDebt()` (@nexamed/core). CHỈ trả số liệu công nợ — KHÔNG
 * trả `receiptNo`/`occurredAt`/`supplierInvoiceNo`/`voided` (tránh `supplier-debt` phải phụ thuộc
 * ngược `inventory` chỉ để join hiển thị): web tự ghép với `GET /inventory/receipts?supplierId=`
 * (đã có sẵn, thêm filter `supplierId`) theo `stockReceiptId`. */
export const supplierDebtReceiptStatusSchema = z.object({
  /** `null` = dòng ảo "Nợ đầu kỳ" (không gắn 1 phiếu nhập cụ thể nào) — xem `isOpeningBalance`. */
  stockReceiptId: z.string().uuid().nullable(),
  isOpeningBalance: z.boolean(),
  /** Tiền hàng GỐC của khoản nợ này (PURCHASE = tiền sau chiết khấu; Nợ đầu kỳ = số đã khai). */
  originalAmount: z.number().int(),
  paidAmount: z.number().int(),
  dueAmount: z.number().int(),
  status: supplierDebtItemStatusSchema,
});
export type SupplierDebtReceiptStatus = z.infer<typeof supplierDebtReceiptStatusSchema>;

export const listSupplierDebtReceiptsResponseSchema = z.object({
  items: z.array(supplierDebtReceiptStatusSchema),
  /** Tổng cộng dòng cuối bảng — không tính phiếu đã huỷ (đúng khuôn footer `stock_receipt`). */
  totalOriginalAmount: z.number().int(),
  totalPaidAmount: z.number().int(),
  totalDueAmount: z.number().int(),
});
export type ListSupplierDebtReceiptsResponse = z.infer<typeof listSupplierDebtReceiptsResponseSchema>;

/**
 * Phần B — `POST /supplier-debt/:supplierId/payment` — "Thanh toán công nợ" trên TỔNG nợ, KHÔNG
 * chọn từng phiếu nhập (phân bổ FIFO ngầm lúc đọc, đúng `allocateSupplierDebt()`). Server tự sinh
 * `description`/`partnerName`/mã phiếu (đúng khuôn "Trả ngay" ở `recordPurchaseApproval()`) — không
 * nhận `description` từ client. `status` (POSTED/PENDING_APPROVAL) do server quyết theo
 * `cashVoucherApprovalEnabled`, không nhận từ client.
 */
export const recordSupplierDebtPaymentRequestSchema = z.object({
  amount: z.number().int().positive('Số tiền thanh toán phải lớn hơn 0.'),
  paymentMethodCode: paymentMethodSchema,
  cashAccountId: z.string().uuid(),
  /** Bỏ trống = "bây giờ". */
  occurredAt: z.string().optional(),
  note: z.string().nullable().optional(),
});
export type RecordSupplierDebtPaymentRequest = z.infer<typeof recordSupplierDebtPaymentRequestSchema>;

/** 1 dòng ở trang "Phiếu thanh toán NCC" (`/suppliers/payments`) + tab "Thanh toán" trên trang chi
 * tiết NCC — chiếu 1 phần `cash_voucher` gắn `supplierId` (Trả ngay lúc nhập HOẶC Thanh toán công nợ
 * Phần B), kèm tên NCC resolve sẵn (web không có danh sách đủ NCC ở trang `/suppliers/payments` lọc
 * "mọi NCC"). */
export const supplierDebtPaymentSchema = z.object({
  id: z.string().uuid(),
  voucherNo: z.string(),
  direction: z.enum(['INCOME', 'EXPENSE']),
  amount: z.number().int(),
  paymentMethodCode: paymentMethodSchema,
  occurredAt: z.string(),
  description: z.string(),
  status: cashVoucherStatusSchema,
  voided: z.boolean(),
  supplierId: z.string().uuid(),
  supplierName: z.string(),
  createdByName: z.string(),
  approvedByName: z.string().nullable(),
  approvedAt: z.string().nullable(),
  rejectionReason: z.string().nullable(),
});
export type SupplierDebtPayment = z.infer<typeof supplierDebtPaymentSchema>;

export const listSupplierDebtPaymentsQuerySchema = z.object({
  supplierId: z.string().uuid().optional(),
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  status: cashVoucherStatusSchema.optional(),
});
export type ListSupplierDebtPaymentsQuery = z.infer<typeof listSupplierDebtPaymentsQuerySchema>;

export const listSupplierDebtPaymentsResponseSchema = z.object({
  items: z.array(supplierDebtPaymentSchema),
  pendingApprovalCount: z.number().int(),
});
export type ListSupplierDebtPaymentsResponse = z.infer<typeof listSupplierDebtPaymentsResponseSchema>;

/**
 * Phần C — `POST /supplier-debt/:supplierId/refund` — "Thu tiền NCC hoàn lại" (Q8), CHỈ gọi được
 * khi `balance < 0` (NCC đang nợ lại phòng khám), `amount ≤ |balance|` (Service chặn, 422 nếu vượt).
 * Sinh `cash_voucher` INCOME (`incomeExpenseTypeCode='SUPPLIER_REFUND'`) — LUÔN `POSTED` ngay (phiếu
 * thu không qua "Duyệt phiếu chi", đúng `CashVoucherService.create()`: chỉ EXPENSE mới xét duyệt).
 * Server tự sinh `description`/`partnerName`/mã phiếu, không nhận từ client.
 */
export const recordSupplierDebtRefundRequestSchema = z.object({
  amount: z.number().int().positive('Số tiền phải lớn hơn 0.'),
  paymentMethodCode: paymentMethodSchema,
  cashAccountId: z.string().uuid(),
  /** Bỏ trống = "bây giờ". */
  occurredAt: z.string().optional(),
  note: z.string().nullable().optional(),
});
export type RecordSupplierDebtRefundRequest = z.infer<typeof recordSupplierDebtRefundRequestSchema>;

/**
 * Phần D "Luồng xử lý sai sót" (docs/DECISIONS.md #180/#182, kế hoạch mục 4). `INCREASE`/`DECREASE`
 * — "Phiếu điều chỉnh công nợ" (Tầng 3, KHÔNG đụng tồn kho/giá vốn). `VOID_REQUEST` — "Đề nghị
 * huỷ" (Tầng 2, người KHÔNG có quyền duyệt phiếu nhập/xuất gốc) — duyệt thì hệ thống tự huỷ hộ
 * chứng từ đó (đúng luồng "Huỷ chứng từ" trực tiếp, chỉ khác người thực thi).
 */
export const supplierDebtAdjustmentKindSchema = z.enum(['INCREASE', 'DECREASE', 'VOID_REQUEST']);
export type SupplierDebtAdjustmentKind = z.infer<typeof supplierDebtAdjustmentKindSchema>;

export const supplierDebtAdjustmentStatusSchema = z.enum(['PENDING_APPROVAL', 'APPROVED', 'REJECTED']);
export type SupplierDebtAdjustmentStatus = z.infer<typeof supplierDebtAdjustmentStatusSchema>;

/** `POST /supplier-debt/adjustments` — `amount` bắt buộc >0 cho `INCREASE`/`DECREASE`, PHẢI bỏ
 * trống cho `VOID_REQUEST`. `VOID_REQUEST` bắt buộc đúng 1 trong `targetReceiptId`/`targetIssueId`,
 * không có `targetVoucherId`. `INCREASE`/`DECREASE` mọi target đều tuỳ chọn (chỉ tham khảo). */
export const createSupplierDebtAdjustmentRequestSchema = z
  .object({
    supplierId: z.string().uuid(),
    kind: supplierDebtAdjustmentKindSchema,
    amount: z.number().int().positive().optional(),
    targetReceiptId: z.string().uuid().nullable().optional(),
    targetIssueId: z.string().uuid().nullable().optional(),
    targetVoucherId: z.string().uuid().nullable().optional(),
    reason: z.string().trim().min(1, 'Phải nhập lý do.'),
    evidenceRef: z.string().nullable().optional(),
  })
  .refine((v) => (v.kind === 'VOID_REQUEST' ? v.amount === undefined : v.amount !== undefined), {
    message: 'Số tiền bắt buộc cho Phiếu điều chỉnh, không nhập cho Đề nghị huỷ.',
    path: ['amount'],
  })
  .refine((v) => (v.kind === 'VOID_REQUEST' ? !v.targetVoucherId : true), {
    message: 'Đề nghị huỷ không gắn phiếu thu/chi.',
    path: ['targetVoucherId'],
  })
  .refine((v) => (v.kind === 'VOID_REQUEST' ? Boolean(v.targetReceiptId) !== Boolean(v.targetIssueId) : true), {
    message: 'Đề nghị huỷ phải chọn đúng 1 phiếu nhập hoặc 1 phiếu xuất trả.',
    path: ['targetReceiptId'],
  });
export type CreateSupplierDebtAdjustmentRequest = z.infer<typeof createSupplierDebtAdjustmentRequestSchema>;

export const approveSupplierDebtAdjustmentRequestSchema = z.object({ version: z.number().int().positive() });
export type ApproveSupplierDebtAdjustmentRequest = z.infer<typeof approveSupplierDebtAdjustmentRequestSchema>;

export const rejectSupplierDebtAdjustmentRequestSchema = z.object({
  rejectionReason: z.string().trim().min(1, 'Phải nhập lý do từ chối.'),
  version: z.number().int().positive(),
});
export type RejectSupplierDebtAdjustmentRequest = z.infer<typeof rejectSupplierDebtAdjustmentRequestSchema>;

/** 1 dòng ở tab "Nhật ký điều chỉnh" (trang chi tiết NCC) + badge "Có điều chỉnh" trên
 * `StockReceiptFormPage`/`StockIssueFormPage` (lọc `targetReceiptId`/`targetIssueId`). */
export const supplierDebtAdjustmentSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int(),
  supplierId: z.string().uuid(),
  supplierName: z.string(),
  adjustmentNo: z.string(),
  kind: supplierDebtAdjustmentKindSchema,
  amount: z.number().int().nullable(),
  targetReceiptId: z.string().uuid().nullable(),
  targetIssueId: z.string().uuid().nullable(),
  targetVoucherId: z.string().uuid().nullable(),
  reason: z.string(),
  evidenceRef: z.string().nullable(),
  status: supplierDebtAdjustmentStatusSchema,
  createdAt: z.string(),
  createdByName: z.string(),
  approvedByName: z.string().nullable(),
  approvedAt: z.string().nullable(),
  /** `true` nếu người duyệt CHÍNH LÀ người đề nghị/lập (nhãn "Tự duyệt", #182 câu 1). */
  selfApproved: z.boolean(),
  rejectionReason: z.string().nullable(),
});
export type SupplierDebtAdjustment = z.infer<typeof supplierDebtAdjustmentSchema>;

export const listSupplierDebtAdjustmentsQuerySchema = z.object({
  supplierId: z.string().uuid().optional(),
  status: supplierDebtAdjustmentStatusSchema.optional(),
  targetReceiptId: z.string().uuid().optional(),
  targetIssueId: z.string().uuid().optional(),
});
export type ListSupplierDebtAdjustmentsQuery = z.infer<typeof listSupplierDebtAdjustmentsQuerySchema>;

export const listSupplierDebtAdjustmentsResponseSchema = z.object({ items: z.array(supplierDebtAdjustmentSchema) });
export type ListSupplierDebtAdjustmentsResponse = z.infer<typeof listSupplierDebtAdjustmentsResponseSchema>;

/**
 * Phần E "Đối chiếu & chốt công nợ theo kỳ" (docs/DECISIONS.md #182 câu 3, kế hoạch mục 4.3/8) —
 * "Biên bản đối chiếu" 1 NCC tại 1 ngày. Gộp 1 bước (chốt qua AskUserQuestion): `POST .../reconciliations`
 * tính `systemBalance`/`differenceAmount` ngay, TỰ CHỐT nếu khớp (0), hoặc tự sinh
 * `supplier_debt_adjustment` PENDING_APPROVAL nếu lệch (nút "Chốt" bị khoá tới khi phiếu đó được xử
 * lý xong — gọi `POST .../reconciliations/:id/finalize` riêng). Sau khi CHỐT, chứng từ của NCC này có
 * ngày ≤ `asOfDate` chỉ Huỷ/Điều chỉnh được bởi người có `supplier_debt.unlock`.
 */
export const supplierDebtReconciliationStatusSchema = z.enum(['DRAFT', 'FINALIZED', 'CANCELLED']);
export type SupplierDebtReconciliationStatus = z.infer<typeof supplierDebtReconciliationStatusSchema>;

export const previewSupplierDebtReconciliationQuerySchema = z.object({
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày đối chiếu không hợp lệ.'),
  confirmedBalance: z.coerce.number().int(),
});
export type PreviewSupplierDebtReconciliationQuery = z.infer<typeof previewSupplierDebtReconciliationQuerySchema>;

export const previewSupplierDebtReconciliationResponseSchema = z.object({
  systemBalance: z.number().int(),
  confirmedBalance: z.number().int(),
  differenceAmount: z.number().int(),
});
export type PreviewSupplierDebtReconciliationResponse = z.infer<typeof previewSupplierDebtReconciliationResponseSchema>;

export const createSupplierDebtReconciliationRequestSchema = z.object({
  asOfDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày đối chiếu không hợp lệ.'),
  confirmedBalance: z.number().int(),
  note: z.string().nullable().optional(),
});
export type CreateSupplierDebtReconciliationRequest = z.infer<typeof createSupplierDebtReconciliationRequestSchema>;

export const finalizeSupplierDebtReconciliationRequestSchema = z.object({ version: z.number().int().positive() });
export type FinalizeSupplierDebtReconciliationRequest = z.infer<typeof finalizeSupplierDebtReconciliationRequestSchema>;

/** Tab "Đối chiếu & Chốt kỳ" trên trang chi tiết NCC — 1 dòng/biên bản. */
export const supplierDebtReconciliationSchema = z.object({
  id: z.string().uuid(),
  version: z.number().int(),
  supplierId: z.string().uuid(),
  reconciliationNo: z.string(),
  asOfDate: z.string(),
  systemBalance: z.number().int(),
  confirmedBalance: z.number().int(),
  differenceAmount: z.number().int(),
  resultingAdjustmentId: z.string().uuid().nullable(),
  /** Trạng thái phiếu điều chỉnh liên kết (nếu có) — web dùng để hiện/disable nút "Chốt" mà không
   * phải gọi riêng `GET /supplier-debt/adjustments`. */
  resultingAdjustmentStatus: supplierDebtAdjustmentStatusSchema.nullable(),
  status: supplierDebtReconciliationStatusSchema,
  note: z.string().nullable(),
  createdAt: z.string(),
  createdByName: z.string(),
  finalizedByName: z.string().nullable(),
  finalizedAt: z.string().nullable(),
});
export type SupplierDebtReconciliation = z.infer<typeof supplierDebtReconciliationSchema>;

export const listSupplierDebtReconciliationsResponseSchema = z.object({ items: z.array(supplierDebtReconciliationSchema) });
export type ListSupplierDebtReconciliationsResponse = z.infer<typeof listSupplierDebtReconciliationsResponseSchema>;
