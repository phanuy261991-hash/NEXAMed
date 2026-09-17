import { z } from 'zod';

/**
 * Kho Thuốc & Vật tư y tế — Giai đoạn 2 (Nhập kho & tồn theo lô, docs/DECISIONS.md #146, kế hoạch
 * kỹ thuật C:\Users\Administrator\.claude\plans\precious-humming-goblet.md, mockup đã duyệt).
 * Module `inventory` sở hữu `stock_receipt`/`stock_receipt_line`/`inventory_batch`/`stock_ledger`/
 * `stock_balance`. GĐ2 chỉ xây 2/5 `receiptType` (PURCHASE/OPENING_BALANCE) và 2/13
 * `stockLedgerReason` (RECEIPT_PURCHASE/RECEIPT_OPENING_BALANCE, cộng RECEIPT_VOID khi huỷ phiếu) —
 * enum còn lại khai sẵn cho GĐ3/4, chưa có UI/logic.
 */

export const stockReceiptTypeSchema = z.enum(['PURCHASE', 'OPENING_BALANCE', 'TRANSFER_IN', 'RETURN_FROM_USE', 'COUNT_SURPLUS']);
export type StockReceiptType = z.infer<typeof stockReceiptTypeSchema>;

export const stockReceiptStatusSchema = z.enum(['DRAFT', 'POSTED', 'REJECTED']);
export type StockReceiptStatus = z.infer<typeof stockReceiptStatusSchema>;

/** 1 dòng hàng — nhập theo ĐÚNG đơn vị/giá trên hoá đơn NCC (không ép quy đổi tay ở client). */
export const stockReceiptLineInputSchema = z.object({
  drugId: z.string().uuid(),
  unitCode: z.string().min(1),
  quantity: z.number().int().positive('Số lượng phải lớn hơn 0.'),
  unitCost: z.number().int().nonnegative(),
  /** Bắt buộc nếu thuốc quản lý theo lô — kiểm ở tầng Service (cần tra `drug.isBatchManaged`, Zod không biết được). */
  batchNo: z.string().min(1).nullable().optional(),
  /** `yyyy-mm-dd`, chỉ ngày — vật tư có thể không có hạn dùng. */
  expiryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
});
export type StockReceiptLineInput = z.infer<typeof stockReceiptLineInputSchema>;

const stockReceiptHeaderFieldsSchema = z.object({
  warehouseId: z.string().uuid(),
  /** Bắt buộc khi `receiptType='PURCHASE'`, bỏ trống các loại khác (Service chặn gửi kèm). */
  supplierId: z.string().uuid().optional(),
  receiptType: stockReceiptTypeSchema,
  /** Bỏ trống mặc định "bây giờ" — cho phép lùi ngày (ví dụ khai tồn đầu kỳ). */
  occurredAt: z.string().optional(),
  note: z.string().nullable().optional(),
  /** Mã hoá đơn NCC — đối chiếu, không dùng để tính toán gì. */
  supplierInvoiceNo: z.string().nullable().optional(),
  lines: z.array(stockReceiptLineInputSchema).min(1, 'Phải có ít nhất 1 dòng hàng.'),
});

/** `POST /inventory/receipts` — tạo phiếu Nháp. `PATCH /inventory/receipts/:id` dùng chung hình
 * dạng này (bulk-replace toàn bộ dòng hàng + header, đúng khuôn `diagnosis`), cộng `version`. */
export const createStockReceiptRequestSchema = stockReceiptHeaderFieldsSchema.superRefine((v, ctx) => {
  if (v.receiptType === 'PURCHASE' && !v.supplierId) {
    ctx.addIssue({ code: 'custom', message: 'Phiếu nhập nhà cung cấp phải chọn Nhà cung cấp.', path: ['supplierId'] });
  }
  if (v.receiptType !== 'PURCHASE' && v.supplierId) {
    ctx.addIssue({ code: 'custom', message: 'Loại phiếu này không có Nhà cung cấp.', path: ['supplierId'] });
  }
});
export type CreateStockReceiptRequest = z.infer<typeof createStockReceiptRequestSchema>;

export const updateStockReceiptRequestSchema = stockReceiptHeaderFieldsSchema
  .extend({ version: z.number().int() })
  .superRefine((v, ctx) => {
    if (v.receiptType === 'PURCHASE' && !v.supplierId) {
      ctx.addIssue({ code: 'custom', message: 'Phiếu nhập nhà cung cấp phải chọn Nhà cung cấp.', path: ['supplierId'] });
    }
    if (v.receiptType !== 'PURCHASE' && v.supplierId) {
      ctx.addIssue({ code: 'custom', message: 'Loại phiếu này không có Nhà cung cấp.', path: ['supplierId'] });
    }
  });
export type UpdateStockReceiptRequest = z.infer<typeof updateStockReceiptRequestSchema>;

export const rejectStockReceiptRequestSchema = z.object({
  reason: z.string().min(1, 'Phải nhập lý do từ chối.'),
  version: z.number().int(),
});
export type RejectStockReceiptRequest = z.infer<typeof rejectStockReceiptRequestSchema>;

export const approveStockReceiptRequestSchema = z.object({ version: z.number().int() });
export type ApproveStockReceiptRequest = z.infer<typeof approveStockReceiptRequestSchema>;

/** `POST /inventory/receipts/:id/void` — huỷ phiếu ĐÃ Duyệt, lý do bắt buộc (CLAUDE.md: không xoá cứng). */
export const voidStockReceiptRequestSchema = z.object({
  reason: z.string().min(1, 'Phải nhập lý do huỷ phiếu.'),
  version: z.number().int(),
});
export type VoidStockReceiptRequest = z.infer<typeof voidStockReceiptRequestSchema>;

export const stockReceiptLineSchema = z.object({
  id: z.string().uuid(),
  drugId: z.string().uuid(),
  drugCode: z.string(),
  drugName: z.string(),
  unitCode: z.string(),
  quantity: z.number().int(),
  unitCost: z.number().int(),
  batchNo: z.string().nullable(),
  expiryDate: z.string().nullable(),
  lineAmount: z.number().int(),
});
export type StockReceiptLine = z.infer<typeof stockReceiptLineSchema>;

export const stockReceiptSummarySchema = z.object({
  id: z.string().uuid(),
  receiptNo: z.string(),
  receiptType: stockReceiptTypeSchema,
  status: stockReceiptStatusSchema,
  warehouseId: z.string().uuid(),
  warehouseName: z.string(),
  supplierId: z.string().uuid().nullable(),
  supplierName: z.string().nullable(),
  occurredAt: z.string(),
  note: z.string().nullable(),
  supplierInvoiceNo: z.string().nullable(),
  totalAmount: z.number().int(),
  lineCount: z.number().int(),
  createdByName: z.string(),
  approvedByName: z.string().nullable(),
  approvedAt: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  /** `true` khi phiếu ĐÃ DUYỆT rồi bị huỷ sau đó (soft-delete) — vẫn hiện, chỉ đọc. */
  voided: z.boolean(),
  version: z.number().int(),
});
export type StockReceiptSummary = z.infer<typeof stockReceiptSummarySchema>;

export const stockReceiptDetailSchema = stockReceiptSummarySchema.extend({
  lines: z.array(stockReceiptLineSchema),
});
export type StockReceiptDetail = z.infer<typeof stockReceiptDetailSchema>;

export const listStockReceiptsQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  warehouseId: z.string().uuid().optional(),
  receiptType: stockReceiptTypeSchema.optional(),
  status: stockReceiptStatusSchema.optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  q: z.string().min(1).max(100).optional(),
});
export type ListStockReceiptsQuery = z.infer<typeof listStockReceiptsQuerySchema>;

export const listStockReceiptsResponseSchema = z.object({
  items: z.array(stockReceiptSummarySchema),
  nextCursor: z.string().nullable(),
});
export type ListStockReceiptsResponse = z.infer<typeof listStockReceiptsResponseSchema>;

// ============ Tồn kho ============

export const stockBalanceStatusSchema = z.enum(['NORMAL', 'LOW', 'HIGH', 'OUT']);
export type StockBalanceStatus = z.infer<typeof stockBalanceStatusSchema>;

export const stockBalanceItemSchema = z.object({
  drugId: z.string().uuid(),
  drugCode: z.string(),
  drugName: z.string(),
  itemType: z.enum(['MEDICINE', 'SUPPLY']),
  warehouseId: z.string().uuid(),
  warehouseName: z.string(),
  unitCode: z.string().nullable(),
  quantityOnHand: z.number().int(),
  minStockAlert: z.number().int().nullable(),
  maxStockAlert: z.number().int().nullable(),
  status: stockBalanceStatusSchema,
});
export type StockBalanceItem = z.infer<typeof stockBalanceItemSchema>;

export const listStockBalancesQuerySchema = z.object({
  warehouseId: z.string().uuid().optional(),
  q: z.string().min(1).max(100).optional(),
  // BUG THẬT đã sửa (16/09/2026): `z.coerce.boolean()` gọi `Boolean(x)` — chuỗi `"false"` từ query
  // string vẫn là chuỗi KHÔNG RỖNG nên bị coi là `true`, khiến bộ lọc "Chỉ hiện dưới định mức tồn"
  // LUÔN bật dù checkbox đang tắt (frontend luôn gửi `belowMinOnly=false` tường minh) — mọi mặt
  // hàng chưa cấu hình `minStockAlert` biến mất khỏi "Tồn kho". Đổi sang đúng khuôn boolean query
  // param đã dùng ở `drug.ts`/`department.ts`/`encounter.ts`.
  belowMinOnly: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .default(false)
    .transform((v) => (typeof v === 'string' ? v === 'true' : v)),
});
export type ListStockBalancesQuery = z.infer<typeof listStockBalancesQuerySchema>;

export const listStockBalancesResponseSchema = z.object({ items: z.array(stockBalanceItemSchema) });
export type ListStockBalancesResponse = z.infer<typeof listStockBalancesResponseSchema>;

// Khai báo trước `drugBatchBalanceItemSchema` bên dưới cần dùng — định nghĩa đầy đủ (kèm
// `stockExpiryWarningItemSchema`) vẫn giữ nguyên vị trí gốc ở mục "Cảnh báo hạn dùng" phía dưới.
export const expiryWarningStatusSchema = z.enum(['EXPIRING_SOON', 'EXPIRED']);
export type ExpiryWarningStatus = z.infer<typeof expiryWarningStatusSchema>;

/** "Tồn kho theo lô" (panel chi tiết thuốc, tab riêng) — 1 thuốc, có thể nhiều kho/lô. */
export const drugBatchBalanceItemSchema = z.object({
  batchId: z.string().uuid(),
  batchNo: z.string(),
  warehouseId: z.string().uuid(),
  warehouseName: z.string(),
  expiryDate: z.string().nullable(),
  quantityOnHand: z.number().int(),
  unitCost: z.number().int(),
  // `null` = còn hạn ngoài ngưỡng cảnh báo (không cần hiện gì) — cùng ngưỡng/logic với "Cảnh báo
  // hạn dùng" (`listExpiryWarnings`), tránh chủ dự án phải bấm sang trang khác mới thấy lô nào sắp/
  // đã hết hạn ngay trong panel chi tiết thuốc (bug thật phát hiện 17/09/2026).
  expiryStatus: expiryWarningStatusSchema.nullable(),
  daysUntilExpiry: z.number().int().nullable(),
});
export type DrugBatchBalanceItem = z.infer<typeof drugBatchBalanceItemSchema>;

export const getDrugBatchBalancesQuerySchema = z.object({ warehouseId: z.string().uuid().optional() });
export type GetDrugBatchBalancesQuery = z.infer<typeof getDrugBatchBalancesQuerySchema>;

export const getDrugBatchBalancesResponseSchema = z.object({
  items: z.array(drugBatchBalanceItemSchema),
  totalQuantityOnHand: z.number().int(),
});
export type GetDrugBatchBalancesResponse = z.infer<typeof getDrugBatchBalancesResponseSchema>;

// ============ Thẻ kho / Lịch sử giao dịch ============

export const stockLedgerReasonSchema = z.enum([
  'RECEIPT_PURCHASE',
  'RECEIPT_OPENING_BALANCE',
  'RECEIPT_TRANSFER_IN',
  'RECEIPT_RETURN_FROM_USE',
  'RECEIPT_COUNT_SURPLUS',
  'RECEIPT_VOID',
  'ISSUE_RETAIL_SALE',
  'ISSUE_SERVICE_CONSUMPTION',
  'ISSUE_INTERNAL_ALLOCATION',
  'ISSUE_TRANSFER_OUT',
  'ISSUE_RETURN_TO_SUPPLIER',
  'ISSUE_WRITE_OFF',
  'ISSUE_COUNT_SHORTAGE',
  'ISSUE_VOID',
]);
export type StockLedgerReason = z.infer<typeof stockLedgerReasonSchema>;

/**
 * 1 dòng thẻ kho — dùng chung cho CẢ 2 tab "Thẻ kho" (Ngày/SL/Tồn sau) và "Lịch sử giao dịch"
 * (Loại chứng từ/Số phiếu/Người tạo) ở panel chi tiết thuốc: ở GĐ2 chỉ có nguồn duy nhất (phiếu
 * nhập kho) nên 2 cách nhìn cùng dữ liệu — tách hẳn 2 API riêng sẽ là bản sao logic không cần
 * thiết. Sẽ tách thật khi GĐ3 có thêm phiếu xuất kho (chứng từ khác `stock_receipt`).
 */
export const stockLedgerEntrySchema = z.object({
  id: z.string().uuid(),
  occurredAt: z.string(),
  quantityChange: z.number().int(),
  runningBalance: z.number().int(),
  reason: stockLedgerReasonSchema,
  warehouseId: z.string().uuid(),
  warehouseName: z.string(),
  sourceReceiptId: z.string().uuid().nullable(),
  sourceReceiptNo: z.string().nullable(),
  // Kho Thuốc GĐ3 (#163) — nguồn phiếu XUẤT (song song sourceReceiptId/No ở trên), đúng ghi chú
  // treo sẵn từ GĐ2 "sẽ tách API thật khi GĐ3 có thêm phiếu xuất kho". Luôn đúng 1 trong 2 nguồn
  // có giá trị (dòng nhập hoặc dòng xuất), không bao giờ cả hai cùng có/cùng null.
  sourceIssueId: z.string().uuid().nullable(),
  sourceIssueNo: z.string().nullable(),
  createdByName: z.string(),
});
export type StockLedgerEntry = z.infer<typeof stockLedgerEntrySchema>;

export const getDrugLedgerQuerySchema = z.object({
  warehouseId: z.string().uuid().optional(),
  /** Bỏ trống = trả toàn bộ (panel chi tiết preview tự cắt 5 dòng ở client cho gọn — dữ liệu GĐ2 còn nhỏ). */
  limit: z.coerce.number().int().min(1).max(500).optional(),
});
export type GetDrugLedgerQuery = z.infer<typeof getDrugLedgerQuerySchema>;

export const getDrugLedgerResponseSchema = z.object({
  items: z.array(stockLedgerEntrySchema),
  totalCount: z.number().int(),
});
export type GetDrugLedgerResponse = z.infer<typeof getDrugLedgerResponseSchema>;

// ============ Cảnh báo hạn dùng ============
// (`expiryWarningStatusSchema` khai báo sớm hơn ở trên, cạnh `drugBatchBalanceItemSchema` — cùng dùng chung)

export const stockExpiryWarningItemSchema = z.object({
  batchId: z.string().uuid(),
  batchNo: z.string(),
  drugId: z.string().uuid(),
  drugName: z.string(),
  warehouseId: z.string().uuid(),
  warehouseName: z.string(),
  expiryDate: z.string(),
  daysUntilExpiry: z.number().int(),
  quantityOnHand: z.number().int(),
  status: expiryWarningStatusSchema,
});
export type StockExpiryWarningItem = z.infer<typeof stockExpiryWarningItemSchema>;

export const listStockExpiryWarningsQuerySchema = z.object({ warehouseId: z.string().uuid().optional() });
export type ListStockExpiryWarningsQuery = z.infer<typeof listStockExpiryWarningsQuerySchema>;

export const listStockExpiryWarningsResponseSchema = z.object({
  items: z.array(stockExpiryWarningItemSchema),
  expiringSoonCount: z.number().int(),
  expiredCount: z.number().int(),
});
export type ListStockExpiryWarningsResponse = z.infer<typeof listStockExpiryWarningsResponseSchema>;

// ============ Kho Thuốc & Vật tư y tế — Giai đoạn 3 (Xuất kho theo đơn + FEFO + tiền thuốc,
// docs/DECISIONS.md #163, kế hoạch kỹ thuật fluttering-scribbling-liskov.md, mockup đã duyệt) ============
// Nguyên tắc cốt lõi (#146, không đổi): đơn thuốc là Y LỆNH — chỉ Phiếu xuất kho (`stock_issue`)
// mới sinh tiền/trừ kho. Một đơn có thể ứng nhiều phiếu xuất — "đã phát" luôn tính từ
// SUM(stock_issue_line.quantity), không lưu cột luỹ kế trên `prescription_item`.

export const stockIssueTypeSchema = z.enum([
  'RETAIL_SALE', // Phát thuốc theo đơn tại quầy — xây GĐ3
  'INTERNAL_ALLOCATION', // Xuất cấp phát nội bộ — để sẵn GĐ4
  'SERVICE_CONSUMPTION', // Xuất tiêu hao theo dịch vụ (vật tư) — để sẵn GĐ4
  'TRANSFER_OUT', // Xuất chuyển kho — để sẵn GĐ4
  'RETURN_TO_SUPPLIER', // Xuất trả nhà cung cấp — để sẵn GĐ4
  'WRITE_OFF', // Xuất huỷ (hỏng/hết hạn) — để sẵn GĐ3/4
  'COUNT_SHORTAGE', // Xuất cân bằng, thiếu hụt kiểm kê — để sẵn GĐ4
]);
export type StockIssueType = z.infer<typeof stockIssueTypeSchema>;

/** KHÔNG có `DRAFT`/`REJECTED` như `stock_receipt` — luồng 1 bước, chọn lô là trừ kho + sinh tiền ngay. */
export const stockIssueStatusSchema = z.enum(['POSTED', 'VOIDED']);
export type StockIssueStatus = z.infer<typeof stockIssueStatusSchema>;

/**
 * 1 dòng hàng lúc tạo phiếu xuất. `prescriptionItemId=null` = dòng OTC bán thêm (không theo đơn),
 * CHỈ hợp lệ khi `drug.isPrescriptionOnly=false` (validate ở Service — cần tra `drug`, Zod không
 * biết được). `batchId=null` khi `drug.isBatchManaged=false`, hoặc khi có mà dược sĩ chọn khác gợi
 * ý FEFO mặc định (không ép cứng FEFO, chỉ gợi ý).
 */
export const stockIssueLineInputSchema = z.object({
  prescriptionItemId: z.string().uuid().nullable().optional(),
  drugId: z.string().uuid(),
  batchId: z.string().uuid().nullable().optional(),
  quantity: z.number().int().positive('Số lượng phải lớn hơn 0.'),
});
export type StockIssueLineInput = z.infer<typeof stockIssueLineInputSchema>;

/** `POST /inventory/issues` — tạo + hoàn tất 1 bước (trừ kho + sinh tiền ngay). */
export const createStockIssueRequestSchema = z.object({
  prescriptionId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  /** Bỏ trống mặc định "bây giờ". */
  occurredAt: z.string().optional(),
  note: z.string().nullable().optional(),
  lines: z.array(stockIssueLineInputSchema).min(1, 'Phải có ít nhất 1 dòng hàng.'),
});
export type CreateStockIssueRequest = z.infer<typeof createStockIssueRequestSchema>;

/** `POST /inventory/issues/:id/void` — huỷ phiếu (phát nhầm), lý do bắt buộc (CLAUDE.md: không xoá cứng). */
export const voidStockIssueRequestSchema = z.object({
  reason: z.string().min(1, 'Phải nhập lý do huỷ phiếu.'),
  version: z.number().int(),
});
export type VoidStockIssueRequest = z.infer<typeof voidStockIssueRequestSchema>;

export const stockIssueLineSchema = z.object({
  id: z.string().uuid(),
  prescriptionItemId: z.string().uuid().nullable(),
  drugId: z.string().uuid(),
  drugCode: z.string(),
  drugName: z.string(),
  batchId: z.string().uuid().nullable(),
  batchNo: z.string().nullable(),
  quantity: z.number().int(),
  unitCost: z.number().int(),
  sellPrice: z.number().int(),
  lineAmount: z.number().int(),
});
export type StockIssueLine = z.infer<typeof stockIssueLineSchema>;

export const stockIssueSummarySchema = z.object({
  id: z.string().uuid(),
  issueNo: z.string(),
  issueType: stockIssueTypeSchema,
  status: stockIssueStatusSchema,
  warehouseId: z.string().uuid(),
  warehouseName: z.string(),
  prescriptionId: z.string().uuid().nullable(),
  encounterId: z.string().uuid().nullable(),
  patientCode: z.string().nullable(),
  patientFullName: z.string().nullable(),
  occurredAt: z.string(),
  note: z.string().nullable(),
  totalAmount: z.number().int(),
  lineCount: z.number().int(),
  createdByName: z.string(),
  voidedByName: z.string().nullable(),
  voidedAt: z.string().nullable(),
  voidReason: z.string().nullable(),
  version: z.number().int(),
});
export type StockIssueSummary = z.infer<typeof stockIssueSummarySchema>;

export const stockIssueDetailSchema = stockIssueSummarySchema.extend({
  lines: z.array(stockIssueLineSchema),
});
export type StockIssueDetail = z.infer<typeof stockIssueDetailSchema>;

export const listStockIssuesQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  warehouseId: z.string().uuid().optional(),
  status: stockIssueStatusSchema.optional(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  q: z.string().min(1).max(100).optional(),
});
export type ListStockIssuesQuery = z.infer<typeof listStockIssuesQuerySchema>;

export const listStockIssuesResponseSchema = z.object({
  items: z.array(stockIssueSummarySchema),
  nextCursor: z.string().nullable(),
});
export type ListStockIssuesResponse = z.infer<typeof listStockIssuesResponseSchema>;

// ============ "Phát thuốc" — trạng thái phát theo đơn + gợi ý lô FEFO ============

/** 1 lô còn tồn, gợi ý theo FEFO (đã sắp `expiryDate` tăng dần, lô không hạn dùng xếp cuối — xem
 * `selectFefoBatches()` ở `@nexamed/core`). Web CHỈ hiển thị đúng thứ tự này, không tính lại. */
export const dispenseBatchOptionSchema = z.object({
  batchId: z.string().uuid(),
  batchNo: z.string(),
  expiryDate: z.string().nullable(),
  quantityOnHand: z.number().int(),
  unitCost: z.number().int(),
});
export type DispenseBatchOption = z.infer<typeof dispenseBatchOptionSchema>;

export const prescriptionDispenseLineSchema = z.object({
  prescriptionItemId: z.string().uuid(),
  drugId: z.string().uuid(),
  drugName: z.string(),
  isBatchManaged: z.boolean(),
  isPrescriptionOnly: z.boolean(),
  prescribedQuantity: z.number().int(),
  dispensedQuantity: z.number().int(),
  remainingQuantity: z.number().int(),
  sellPrice: z.number().int(),
  /** Chỉ có ý nghĩa khi `isBatchManaged=true` — rỗng nếu hết tồn mọi lô. */
  suggestedBatches: z.array(dispenseBatchOptionSchema),
});
export type PrescriptionDispenseLine = z.infer<typeof prescriptionDispenseLineSchema>;

export const getPrescriptionDispenseStatusQuerySchema = z.object({ warehouseId: z.string().uuid().optional() });
export type GetPrescriptionDispenseStatusQuery = z.infer<typeof getPrescriptionDispenseStatusQuerySchema>;

export const getPrescriptionDispenseStatusResponseSchema = z.object({
  prescriptionId: z.string().uuid(),
  encounterId: z.string().uuid(),
  signedAt: z.string().nullable(),
  lines: z.array(prescriptionDispenseLineSchema),
});
export type GetPrescriptionDispenseStatusResponse = z.infer<typeof getPrescriptionDispenseStatusResponseSchema>;

// ============ "Phát thuốc" — hàng đợi đơn đã ký còn thuốc chưa phát hết ============

export const dispenseQueueItemSchema = z.object({
  prescriptionId: z.string().uuid(),
  encounterId: z.string().uuid(),
  encounterNo: z.string(),
  patientId: z.string().uuid(),
  patientCode: z.string(),
  patientFullName: z.string(),
  phone: z.string(),
  signedAt: z.string(),
  totalPrescribedQuantity: z.number().int(),
  totalDispensedQuantity: z.number().int(),
  fullyDispensed: z.boolean(),
});
export type DispenseQueueItem = z.infer<typeof dispenseQueueItemSchema>;

export const listDispenseQueueQuerySchema = z.object({
  q: z.string().min(1).max(100).optional(),
  /** Mặc định chỉ đơn ký trong 30 ngày gần nhất (tránh hàng đợi phình to gây rối mắt) — bật để hiện
   * cả đơn cũ hơn (đơn thuốc là y lệnh, không tự "hết hạn"/biến mất). */
  includeOlder: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .default(false)
    .transform((v) => (typeof v === 'string' ? v === 'true' : v)),
});
export type ListDispenseQueueQuery = z.infer<typeof listDispenseQueueQuerySchema>;

export const listDispenseQueueResponseSchema = z.object({ items: z.array(dispenseQueueItemSchema) });
export type ListDispenseQueueResponse = z.infer<typeof listDispenseQueueResponseSchema>;
