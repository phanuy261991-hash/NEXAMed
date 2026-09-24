import { z } from 'zod';
import { invoiceTypeSchema, discountTypeSchema } from './billing';

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
  /** Chiết khấu "Từng dòng" (Kho Thuốc GĐ4, "Phiếu nhập kho mở rộng", docs/DECISIONS.md #170) — CHỈ
   * có ý nghĩa khi phiếu cha `receiptType='PURCHASE'` VÀ không dòng nào khác đồng thời dùng chiết
   * khấu cấp header (Service kiểm mutual-exclusion, đúng tinh thần `computeInvoiceDiscount()`). */
  discountType: discountTypeSchema.nullable().optional(),
  discountValue: z.number().int().positive().nullable().optional(),
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
  /** Chiết khấu "Toàn phiếu" — CHỈ có ý nghĩa khi `receiptType='PURCHASE'`, loại trừ lẫn nhau với
   * chiết khấu "Từng dòng" (`lines[].discountType`) — chọn 1 trong 2, không cộng dồn (đúng thiết kế
   * đã chốt ở Thu ngân #137, tái dùng nguyên `computeInvoiceDiscount()` ở `@nexamed/core`). */
  discountType: discountTypeSchema.nullable().optional(),
  discountValue: z.number().int().positive().nullable().optional(),
  discountReason: z.string().nullable().optional(),
  /** "Trả ngay" cho NCC (Công nợ nhà cung cấp, docs/DECISIONS.md #180/#182) — CHỈ có ý nghĩa khi
   * `receiptType='PURCHASE'` (Service chặn gửi kèm ở loại khác, cùng cách `discountType` xử lý).
   * Khai lúc Nháp, phiếu chi CHỈ thực sự sinh lúc Duyệt phiếu (§2.4 kế hoạch kỹ thuật). Mặc định 0
   * = ghi nợ hết (không phải chip tô sẵn, đúng mockup màn 5). */
  prepaidAmount: z.number().int().nonnegative().optional(),
  prepaidPaymentMethodCode: z.string().min(1).nullable().optional(),
  prepaidCashAccountId: z.string().uuid().nullable().optional(),
  lines: z.array(stockReceiptLineInputSchema).min(1, 'Phải có ít nhất 1 dòng hàng.'),
});

function checkStockReceiptPrepaidRules(v: z.infer<typeof stockReceiptHeaderFieldsSchema>, ctx: z.RefinementCtx): void {
  const prepaidAmount = v.prepaidAmount ?? 0;
  if (prepaidAmount > 0 && v.receiptType !== 'PURCHASE') {
    ctx.addIssue({ code: 'custom', message: 'Chỉ phiếu "Nhập nhà cung cấp" mới có "Trả ngay".', path: ['prepaidAmount'] });
  }
  if (prepaidAmount > 0) {
    if (!v.prepaidPaymentMethodCode) {
      ctx.addIssue({ code: 'custom', message: 'Phải chọn Phương thức thanh toán khi có Trả ngay.', path: ['prepaidPaymentMethodCode'] });
    }
    if (!v.prepaidCashAccountId) {
      ctx.addIssue({ code: 'custom', message: 'Phải chọn Quỹ chi khi có Trả ngay.', path: ['prepaidCashAccountId'] });
    }
  }
}

function checkStockReceiptDiscountRules(v: z.infer<typeof stockReceiptHeaderFieldsSchema>, ctx: z.RefinementCtx): void {
  const hasHeaderDiscount = v.discountType != null;
  const hasLineDiscount = v.lines.some((l) => l.discountType != null);
  if ((hasHeaderDiscount || hasLineDiscount) && v.receiptType !== 'PURCHASE') {
    ctx.addIssue({ code: 'custom', message: 'Chỉ phiếu "Nhập nhà cung cấp" mới áp dụng chiết khấu.', path: ['discountType'] });
  }
  if (hasHeaderDiscount && hasLineDiscount) {
    ctx.addIssue({ code: 'custom', message: 'Chỉ chọn 1 trong 2 cách chiết khấu — Toàn phiếu hoặc Từng dòng.', path: ['discountType'] });
  }
  if (hasHeaderDiscount) {
    if (v.discountValue == null) {
      ctx.addIssue({ code: 'custom', message: 'Phải nhập giá trị chiết khấu.', path: ['discountValue'] });
    } else if (v.discountType === 'PERCENT' && v.discountValue > 100) {
      ctx.addIssue({ code: 'custom', message: 'Chiết khấu theo % không vượt quá 100.', path: ['discountValue'] });
    }
    if (!v.discountReason) {
      ctx.addIssue({ code: 'custom', message: 'Phải nhập lý do chiết khấu.', path: ['discountReason'] });
    }
  }
  v.lines.forEach((l, i) => {
    if (l.discountType === 'PERCENT' && l.discountValue != null && l.discountValue > 100) {
      ctx.addIssue({ code: 'custom', message: 'Chiết khấu theo % không vượt quá 100.', path: ['lines', i, 'discountValue'] });
    }
  });
}

/** `POST /inventory/receipts` — tạo phiếu Nháp. `PATCH /inventory/receipts/:id` dùng chung hình
 * dạng này (bulk-replace toàn bộ dòng hàng + header, đúng khuôn `diagnosis`), cộng `version`. */
export const createStockReceiptRequestSchema = stockReceiptHeaderFieldsSchema.superRefine((v, ctx) => {
  if (v.receiptType === 'PURCHASE' && !v.supplierId) {
    ctx.addIssue({ code: 'custom', message: 'Phiếu nhập nhà cung cấp phải chọn Nhà cung cấp.', path: ['supplierId'] });
  }
  if (v.receiptType !== 'PURCHASE' && v.supplierId) {
    ctx.addIssue({ code: 'custom', message: 'Loại phiếu này không có Nhà cung cấp.', path: ['supplierId'] });
  }
  checkStockReceiptDiscountRules(v, ctx);
  checkStockReceiptPrepaidRules(v, ctx);
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
    checkStockReceiptDiscountRules(v, ctx);
    checkStockReceiptPrepaidRules(v, ctx);
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
  /** Chiết khấu "Từng dòng" (Kho Thuốc GĐ4, docs/DECISIONS.md #170) — `discountType` null khi dòng
   * không chiết khấu (kể cả khi phiếu dùng chế độ "Toàn phiếu"). `discountAmount` đã tính sẵn. */
  discountType: discountTypeSchema.nullable(),
  discountValue: z.number().int().nullable(),
  discountAmount: z.number().int(),
});
export type StockReceiptLine = z.infer<typeof stockReceiptLineSchema>;

export const stockReceiptDiscountModeSchema = z.enum(['NONE', 'TOTAL', 'PER_LINE']);
export type StockReceiptDiscountMode = z.infer<typeof stockReceiptDiscountModeSchema>;

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
  /** Tổng tiền hàng TRƯỚC chiết khấu (gross) — giữ nguyên ý nghĩa cũ. */
  totalAmount: z.number().int(),
  /** Chiết khấu "Toàn phiếu" cấp header (Kho Thuốc GĐ4, docs/DECISIONS.md #170) — RAW, đọc thẳng từ
   * DB, `null` khi không dùng cách này (dùng "Từng dòng" hoặc không chiết khấu). Số tiền chiết khấu
   * ĐÃ TÍNH (`discountAmount`/`netAmount`, cần đọc cả `lines` mới tính đúng mode PER_LINE) chỉ có ở
   * `stockReceiptDetailSchema`, không lặp lại ở đây (LIST không tải `lines`). */
  discountType: discountTypeSchema.nullable(),
  discountValue: z.number().int().nullable(),
  discountReason: z.string().nullable(),
  /** "Trả ngay" cho NCC (Công nợ nhà cung cấp, docs/DECISIONS.md #180/#182) — `prepaidVoucherId`
   * chỉ có giá trị SAU khi phiếu đã Duyệt kèm `prepaidAmount > 0` (sinh lúc Duyệt, không phải lúc
   * khai Nháp). Xem chi tiết phiếu chi này ở "Phiếu thanh toán NCC" (Phần B) qua `prepaidVoucherId`. */
  prepaidAmount: z.number().int(),
  prepaidPaymentMethodCode: z.string().nullable(),
  prepaidCashAccountId: z.string().uuid().nullable(),
  prepaidVoucherId: z.string().uuid().nullable(),
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
  /** `discountMode` suy ra ở Service (đúng tinh thần `computeInvoiceDiscount()`) từ `discountType`
   * cấp header VÀ `lines[].discountType`. `netAmount = totalAmount - discountAmount` — số tiền hàng
   * THẬT sau chiết khấu, dùng để hiển thị "Thành tiền". */
  discountMode: stockReceiptDiscountModeSchema,
  discountAmount: z.number().int(),
  netAmount: z.number().int(),
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
  /** Tab "Phiếu nhập" ở trang chi tiết NCC (Công nợ nhà cung cấp, #180/#182) — web ghép danh sách
   * này với `GET /supplier-debt/:supplierId/receipts` theo `stockReceiptId` để hiện đủ receiptNo/
   * occurredAt/voided cạnh trạng thái công nợ, tránh `supplier-debt` phải phụ thuộc ngược `inventory`. */
  supplierId: z.string().uuid().optional(),
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

/** Kho Thuốc GĐ4, "Phiếu xuất kho mở rộng" (docs/DECISIONS.md #170) — thêm `DRAFT`/`REJECTED` cho 3
 * loại phiếu xuất mới (`MANUAL_STOCK_ISSUE_TYPES` dưới đây), luồng Nháp→Duyệt đúng khuôn
 * `stock_receipt`. `RETAIL_SALE`/`TRANSFER_OUT`/`COUNT_SHORTAGE` GIỮ NGUYÊN tạo thẳng `POSTED`. */
export const stockIssueStatusSchema = z.enum(['DRAFT', 'POSTED', 'REJECTED', 'VOIDED']);
export type StockIssueStatus = z.infer<typeof stockIssueStatusSchema>;

/** 3 loại phiếu xuất Nháp→Duyệt lập TAY (khác `RETAIL_SALE` 1 bước, và khác `TRANSFER_OUT`/
 * `COUNT_SHORTAGE` tự sinh bởi hệ thống) — dùng chung cho Zod enum lẫn `SUPPORTED_MANUAL_ISSUE_TYPES`
 * ở `StockIssueService`. */
export const manualStockIssueTypeSchema = z.enum(['INTERNAL_ALLOCATION', 'RETURN_TO_SUPPLIER', 'WRITE_OFF']);
export type ManualStockIssueType = z.infer<typeof manualStockIssueTypeSchema>;

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

// ============ Kho Thuốc GĐ4, "Phiếu xuất kho mở rộng" (docs/DECISIONS.md #170, kế hoạch kỹ thuật
// bright-bubbling-axolotl.md mục 4, mockup đã duyệt) — 3 loại phiếu xuất Nháp→Duyệt lập tay: Xuất
// dùng nội bộ (INTERNAL_ALLOCATION)/Xuất trả nhà cung cấp (RETURN_TO_SUPPLIER)/Xuất huỷ (WRITE_OFF).
// Không gắn đơn thuốc/hoá đơn nào (thuần điều chỉnh tồn kho, sellPrice/lineAmount luôn 0 — cùng
// bản chất COUNT_SHORTAGE/TRANSFER_OUT tự sinh). ============

/** 1 dòng hàng lúc lập phiếu xuất Nháp — không có `prescriptionItemId` (không gắn đơn thuốc). */
export const manualStockIssueLineInputSchema = z.object({
  drugId: z.string().uuid(),
  batchId: z.string().uuid().nullable().optional(),
  quantity: z.number().int().positive('Số lượng phải lớn hơn 0.'),
});
export type ManualStockIssueLineInput = z.infer<typeof manualStockIssueLineInputSchema>;

const manualStockIssueHeaderFieldsSchema = z.object({
  issueType: manualStockIssueTypeSchema,
  warehouseId: z.string().uuid(),
  /** Khoa/Phòng TIẾP NHẬN — bắt buộc khi `issueType='INTERNAL_ALLOCATION'`, bỏ trống loại khác
   * (Service chặn gửi kèm, đúng khuôn `supplierId` của `stock_receipt`). */
  departmentId: z.string().uuid().optional(),
  /** Bỏ trống mặc định "bây giờ". */
  occurredAt: z.string().optional(),
  /** "Lý do" — BẮT BUỘC cho cả 3 loại (kế hoạch #170 mục 4), tái dùng cột `note` có sẵn. */
  note: z.string().min(1, 'Phải nhập lý do.'),
  lines: z.array(manualStockIssueLineInputSchema).min(1, 'Phải có ít nhất 1 dòng hàng.'),
});

function checkManualStockIssueDepartment(v: z.infer<typeof manualStockIssueHeaderFieldsSchema>, ctx: z.RefinementCtx): void {
  if (v.issueType === 'INTERNAL_ALLOCATION' && !v.departmentId) {
    ctx.addIssue({ code: 'custom', message: 'Phiếu "Xuất dùng nội bộ" phải chọn Khoa/Phòng tiếp nhận.', path: ['departmentId'] });
  }
  if (v.issueType !== 'INTERNAL_ALLOCATION' && v.departmentId) {
    ctx.addIssue({ code: 'custom', message: 'Loại phiếu này không có Khoa/Phòng tiếp nhận.', path: ['departmentId'] });
  }
}

/** `POST /inventory/issues/manual` — tạo phiếu Nháp. `PATCH /inventory/issues/manual/:id` dùng
 * chung hình dạng này (bulk-replace toàn bộ dòng hàng + header, đúng khuôn `stock_receipt`), cộng
 * `version`. Route riêng khỏi `POST /inventory/issues` (luồng "Phát thuốc" 1 bước, không đổi). */
export const createManualStockIssueRequestSchema = manualStockIssueHeaderFieldsSchema.superRefine(checkManualStockIssueDepartment);
export type CreateManualStockIssueRequest = z.infer<typeof createManualStockIssueRequestSchema>;

export const updateManualStockIssueRequestSchema = manualStockIssueHeaderFieldsSchema
  .extend({ version: z.number().int() })
  .superRefine(checkManualStockIssueDepartment);
export type UpdateManualStockIssueRequest = z.infer<typeof updateManualStockIssueRequestSchema>;

export const approveStockIssueRequestSchema = z.object({ version: z.number().int() });
export type ApproveStockIssueRequest = z.infer<typeof approveStockIssueRequestSchema>;

export const rejectStockIssueRequestSchema = z.object({
  reason: z.string().min(1, 'Phải nhập lý do từ chối.'),
  version: z.number().int(),
});
export type RejectStockIssueRequest = z.infer<typeof rejectStockIssueRequestSchema>;

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
  // Kho Thuốc GĐ4, "Phiếu xuất kho mở rộng" (docs/DECISIONS.md #170) — chỉ có giá trị cho 3 loại
  // Nháp→Duyệt lập tay (`manualStockIssueTypeSchema`), `null` cho `RETAIL_SALE`/tự sinh hệ thống.
  approvedByName: z.string().nullable(),
  approvedAt: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  departmentId: z.string().uuid().nullable(),
  departmentName: z.string().nullable(),
  voidedByName: z.string().nullable(),
  voidedAt: z.string().nullable(),
  voidReason: z.string().nullable(),
  version: z.number().int(),
});
export type StockIssueSummary = z.infer<typeof stockIssueSummarySchema>;

/** Kho Thuốc GĐ3 (#165) — hoá đơn ĐÃ cộng tiền của phiếu xuất này (`InvoiceRepository.
 * findByStockIssueLineIds()`) — `null` chỉ khi phiếu chưa có dòng nào (không xảy ra thực tế, mọi
 * phiếu xuất luôn có ≥1 dòng). Dùng cho nút "Xem hoá đơn" ở màn thành công `DispensePrescriptionDialog.tsx`. */
export const stockIssueAttachedInvoiceSchema = z.object({
  invoiceId: z.string().uuid(),
  invoiceNo: z.string(),
  invoiceType: invoiceTypeSchema,
});
export type StockIssueAttachedInvoice = z.infer<typeof stockIssueAttachedInvoiceSchema>;

export const stockIssueDetailSchema = stockIssueSummarySchema.extend({
  lines: z.array(stockIssueLineSchema),
  attachedInvoice: stockIssueAttachedInvoiceSchema.nullable(),
});
export type StockIssueDetail = z.infer<typeof stockIssueDetailSchema>;

export const listStockIssuesQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  warehouseId: z.string().uuid().optional(),
  status: stockIssueStatusSchema.optional(),
  /** Kho Thuốc GĐ4 (#170) — lọc theo loại phiếu xuất. Cần thiết ngay từ phần "Kiểm kê": phiếu
   * `COUNT_SHORTAGE` tự sinh không gắn bệnh nhân/lượt khám nào, "Đã phát hôm nay"
   * (`DispenseQueuePage.tsx`) phải lọc CHỈ `RETAIL_SALE` để không hiện dòng thiếu thông tin bệnh nhân. */
  issueType: stockIssueTypeSchema.optional(),
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
  /** Tổng tồn kho THẬT của mặt hàng này tại kho đang chọn (SUM mọi lô nếu quản lý theo lô, hoặc
   * dòng `stock_balance` phi-lô) — tách biệt hoàn toàn với `remainingQuantity` (còn lại THEO ĐƠN,
   * không liên quan tồn kho). Thêm để tránh nhầm lẫn "còn lại theo đơn" với "tồn kho thực tế". */
  warehouseStockOnHand: z.number().int(),
});
export type PrescriptionDispenseLine = z.infer<typeof prescriptionDispenseLineSchema>;

export const getPrescriptionDispenseStatusQuerySchema = z.object({ warehouseId: z.string().uuid().optional() });
export type GetPrescriptionDispenseStatusQuery = z.infer<typeof getPrescriptionDispenseStatusQuerySchema>;

export const getPrescriptionDispenseStatusResponseSchema = z.object({
  prescriptionId: z.string().uuid(),
  encounterId: z.string().uuid(),
  /** Tên/mã bệnh nhân — rà soát 22/09/2026 (chủ dự án phát hiện dialog "Phát thuốc" không hiện đang
   * phát cho ai). `dispenseQueueItemSchema` (hàng đợi) đã có sẵn 2 field này từ đầu, giờ mới thêm
   * vào API dialog thật sự dùng. */
  patientFullName: z.string(),
  patientCode: z.string(),
  signedAt: z.string().nullable(),
  /** "Mã đơn thuốc thật" (docs/DECISIONS.md #169) — 3 field cấp ĐƠN (không phải cấp dòng thuốc),
   * hiện ở khối thông tin đầu `DispensePrescriptionDialog.tsx`. `null` chỉ khi đơn chưa ký (không
   * xảy ra thực tế — hàng đợi/dialog phát thuốc chỉ mở cho đơn ĐÃ KÝ) hoặc backfill lỗi. */
  prescriptionNo: z.string().nullable(),
  signedByName: z.string().nullable(),
  /** TẤT CẢ chẩn đoán (chính + phụ nếu có) của lượt khám, định dạng "{tên bệnh} ({mã ICD-10})" nối
   * bằng " / " — đúng ảnh tham khảo chủ dự án gửi, không chỉ riêng chẩn đoán chính. `null` nếu lượt
   * khám chưa có chẩn đoán nào (không xảy ra thực tế — bắt buộc ≥1 chẩn đoán chính trước khi ký đơn). */
  diagnosisLabel: z.string().nullable(),
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

// ============ Kho Thuốc & Vật tư y tế — Giai đoạn 4 (Kiểm kê / Điều chuyển / Mở rộng Nhập-Xuất
// kho / Báo cáo N-X-T, docs/DECISIONS.md #170, kế hoạch kỹ thuật bright-bubbling-axolotl.md, mockup
// đã duyệt). Phần "Kiểm kê" trước — Điều chuyển/mở rộng Nhập-Xuất/Báo cáo N-X-T là các phần sau,
// từng phần dựng mockup + duyệt riêng trước khi code, theo đúng quy ước dự án. ============

export const stockCountStatusSchema = z.enum(['DRAFT', 'POSTED', 'REJECTED']);
export type StockCountStatus = z.infer<typeof stockCountStatusSchema>;

/**
 * 1 dòng đếm — đúng 1 dòng/(drug, lô cụ thể). `batchId` có giá trị = lô ĐÃ tồn tại trong hệ thống
 * lúc thêm dòng (Combobox chọn lô thật, gửi `id` thẳng — khác `stock_receipt_line` gõ `batchNo` tự
 * do). `newBatchNo`/`newBatchExpiryDate` chỉ dùng khi `batchId` bỏ trống VÀ thuốc quản lý theo lô —
 * lô MỚI phát hiện lúc đếm, chưa từng có trong hệ thống (nút "+ Thêm lô mới" ở mockup).
 * `systemQuantitySnapshot` CHỈ hiển thị tham khảo lúc thêm dòng — Duyệt đọc lại tồn kho SỐNG, không
 * dùng số này để tính (đúng thiết kế đã chốt).
 */
export const stockCountLineInputSchema = z.object({
  drugId: z.string().uuid(),
  batchId: z.string().uuid().nullable().optional(),
  newBatchNo: z.string().min(1).nullable().optional(),
  /** `yyyy-mm-dd`, chỉ ngày — chỉ có ý nghĩa cùng `newBatchNo`. */
  newBatchExpiryDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .nullable()
    .optional(),
  systemQuantitySnapshot: z.number().int().nonnegative(),
  countedQuantity: z.number().int().nonnegative(),
});
export type StockCountLineInput = z.infer<typeof stockCountLineInputSchema>;

const stockCountHeaderFieldsSchema = z.object({
  warehouseId: z.string().uuid(),
  /** Bỏ trống mặc định "bây giờ". */
  occurredAt: z.string().optional(),
  note: z.string().nullable().optional(),
  lines: z.array(stockCountLineInputSchema).min(1, 'Phải có ít nhất 1 dòng đếm.'),
});

/** `POST /inventory/counts` — tạo phiếu Nháp. `PATCH /inventory/counts/:id` dùng chung hình dạng
 * này (bulk-replace toàn bộ dòng đếm + header, đúng khuôn `stock_receipt`), cộng `version`. */
export const createStockCountRequestSchema = stockCountHeaderFieldsSchema;
export type CreateStockCountRequest = z.infer<typeof createStockCountRequestSchema>;

export const updateStockCountRequestSchema = stockCountHeaderFieldsSchema.extend({ version: z.number().int() });
export type UpdateStockCountRequest = z.infer<typeof updateStockCountRequestSchema>;

export const rejectStockCountRequestSchema = z.object({
  reason: z.string().min(1, 'Phải nhập lý do từ chối.'),
  version: z.number().int(),
});
export type RejectStockCountRequest = z.infer<typeof rejectStockCountRequestSchema>;

/** `reason` chỉ bắt buộc THẬT khi phiếu có dòng dư/thiếu (Service kiểm tra sau khi đọc tồn kho
 * SỐNG — Zod không biết trước được, chỉ khai `optional()` ở đây). Rà soát lỗ hổng quy trình
 * 22/09/2026: trước đây Duyệt tự động sửa tồn kho không cần giải trình gì. */
export const approveStockCountRequestSchema = z.object({ version: z.number().int(), reason: z.string().trim().min(1).optional() });
export type ApproveStockCountRequest = z.infer<typeof approveStockCountRequestSchema>;

export const stockCountLineSchema = z.object({
  id: z.string().uuid(),
  drugId: z.string().uuid(),
  drugCode: z.string(),
  drugName: z.string(),
  isBatchManaged: z.boolean(),
  batchId: z.string().uuid().nullable(),
  /** Số lô hiển thị — của lô ĐÃ có (`batchId`) hoặc `newBatchNo` (lô mới), tuỳ trường hợp nào áp dụng. */
  batchNo: z.string().nullable(),
  expiryDate: z.string().nullable(),
  isNewBatch: z.boolean(),
  systemQuantitySnapshot: z.number().int(),
  countedQuantity: z.number().int(),
  /** `null` khi phiếu còn `DRAFT` (chưa Duyệt) — có giá trị SAU khi Duyệt, đúng số đã dùng để sinh dư/thiếu. */
  difference: z.number().int().nullable(),
});
export type StockCountLine = z.infer<typeof stockCountLineSchema>;

export const stockCountSummarySchema = z.object({
  id: z.string().uuid(),
  countNo: z.string(),
  status: stockCountStatusSchema,
  warehouseId: z.string().uuid(),
  warehouseName: z.string(),
  occurredAt: z.string(),
  note: z.string().nullable(),
  lineCount: z.number().int(),
  createdByName: z.string(),
  approvedByName: z.string().nullable(),
  approvedAt: z.string().nullable(),
  /** Lý do giải trình chênh lệch nhập lúc Duyệt — chỉ có giá trị khi phiếu có dòng dư/thiếu (Service
   * bắt buộc, xem `approveStockCountRequestSchema`). `null` với phiếu khớp hoàn toàn hoặc chưa Duyệt. */
  approvalReason: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  version: z.number().int(),
});
export type StockCountSummary = z.infer<typeof stockCountSummarySchema>;

export const stockCountDetailSchema = stockCountSummarySchema.extend({ lines: z.array(stockCountLineSchema) });
export type StockCountDetail = z.infer<typeof stockCountDetailSchema>;

export const listStockCountsQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  warehouseId: z.string().uuid().optional(),
  status: stockCountStatusSchema.optional(),
  q: z.string().min(1).max(100).optional(),
});
export type ListStockCountsQuery = z.infer<typeof listStockCountsQuerySchema>;

export const listStockCountsResponseSchema = z.object({
  items: z.array(stockCountSummarySchema),
  nextCursor: z.string().nullable(),
});
export type ListStockCountsResponse = z.infer<typeof listStockCountsResponseSchema>;

// ============ Kho Thuốc & Vật tư y tế — Giai đoạn 4, phần "Điều chuyển kho" (docs/DECISIONS.md
// #170, kế hoạch kỹ thuật bright-bubbling-axolotl.md, mockup đã duyệt). 1 LUỒNG DUY NHẤT tự sinh
// CẶP chứng từ liên kết, tách 2 bước: Duyệt (DRAFT→IN_TRANSIT, xuất kho NGUỒN ngay) → Xác nhận
// nhận hàng (IN_TRANSIT→COMPLETED, nhập kho ĐÍCH đúng số THỰC NHẬN). KHÔNG hỗ trợ Huỷ sau khi đã
// IN_TRANSIT. Luôn ở đơn vị CƠ SỞ (không chọn đơn vị như `stock_receipt`, đúng khuôn `stock_count`/
// `stock_issue`). ============

export const stockTransferStatusSchema = z.enum(['DRAFT', 'IN_TRANSIT', 'COMPLETED', 'REJECTED']);
export type StockTransferStatus = z.infer<typeof stockTransferStatusSchema>;

/** 1 dòng hàng — `batchId` bắt buộc nếu thuốc quản lý theo lô (kiểm ở Service, cần tra
 * `drug.isBatchManaged`). Lô phải ĐÃ tồn tại TẠI KHO NGUỒN — khác `stock_count`, không có khái
 * niệm "lô mới" ở đây (hàng phải có thật mới chuyển được). */
export const stockTransferLineInputSchema = z.object({
  drugId: z.string().uuid(),
  batchId: z.string().uuid().nullable().optional(),
  quantityShipped: z.number().int().positive('Số lượng chuyển phải lớn hơn 0.'),
});
export type StockTransferLineInput = z.infer<typeof stockTransferLineInputSchema>;

const stockTransferHeaderFieldsSchema = z.object({
  fromWarehouseId: z.string().uuid(),
  toWarehouseId: z.string().uuid(),
  /** Bỏ trống mặc định "bây giờ". */
  occurredAt: z.string().optional(),
  note: z.string().nullable().optional(),
  lines: z.array(stockTransferLineInputSchema).min(1, 'Phải có ít nhất 1 dòng hàng.'),
});

function checkStockTransferDifferentWarehouses(v: { fromWarehouseId: string; toWarehouseId: string }, ctx: z.RefinementCtx): void {
  if (v.fromWarehouseId === v.toWarehouseId) {
    ctx.addIssue({ code: 'custom', message: 'Kho nguồn và kho đích phải khác nhau.', path: ['toWarehouseId'] });
  }
}

/** `POST /inventory/transfers` — tạo phiếu Nháp. `PATCH /inventory/transfers/:id` dùng chung hình
 * dạng này (bulk-replace toàn bộ dòng hàng + header, đúng khuôn `stock_receipt`/`stock_count`),
 * cộng `version`. */
export const createStockTransferRequestSchema = stockTransferHeaderFieldsSchema.superRefine(checkStockTransferDifferentWarehouses);
export type CreateStockTransferRequest = z.infer<typeof createStockTransferRequestSchema>;

export const updateStockTransferRequestSchema = stockTransferHeaderFieldsSchema
  .extend({ version: z.number().int() })
  .superRefine(checkStockTransferDifferentWarehouses);
export type UpdateStockTransferRequest = z.infer<typeof updateStockTransferRequestSchema>;

export const rejectStockTransferRequestSchema = z.object({
  reason: z.string().min(1, 'Phải nhập lý do từ chối.'),
  version: z.number().int(),
});
export type RejectStockTransferRequest = z.infer<typeof rejectStockTransferRequestSchema>;

/** `POST /inventory/transfers/:id/ship` — Duyệt (xuất kho NGUỒN ngay), DRAFT→IN_TRANSIT. */
export const shipStockTransferRequestSchema = z.object({ version: z.number().int() });
export type ShipStockTransferRequest = z.infer<typeof shipStockTransferRequestSchema>;

/** 1 dòng lúc Xác nhận nhận hàng — `quantityReceived` gửi TƯỜNG MINH cho MỌI dòng (FE mặc định
 * = `quantityShipped`, người dùng sửa xuống thấp hơn nếu cần). `varianceNote` bắt buộc THẬT chỉ khi
 * `quantityReceived < quantityShipped` (Service kiểm tra sau khi so với số đã lưu trên dòng, Zod
 * không biết trước được). Chặn CỨNG nhận nhiều hơn — Zod chỉ chặn âm, Service + CHECK DB chặn vượt
 * `quantityShipped`. */
export const receiveStockTransferLineInputSchema = z.object({
  lineId: z.string().uuid(),
  quantityReceived: z.number().int().nonnegative(),
  varianceNote: z.string().trim().min(1).nullable().optional(),
});
export type ReceiveStockTransferLineInput = z.infer<typeof receiveStockTransferLineInputSchema>;

/** `POST /inventory/transfers/:id/receive` — Xác nhận nhận hàng, IN_TRANSIT→COMPLETED. MỘT LẦN
 * DUY NHẤT (không hỗ trợ nhận nhiều đợt/một phần — kế hoạch #170 mục 8). */
export const receiveStockTransferRequestSchema = z.object({
  version: z.number().int(),
  lines: z.array(receiveStockTransferLineInputSchema).min(1),
});
export type ReceiveStockTransferRequest = z.infer<typeof receiveStockTransferRequestSchema>;

export const stockTransferLineSchema = z.object({
  id: z.string().uuid(),
  drugId: z.string().uuid(),
  drugCode: z.string(),
  drugName: z.string(),
  isBatchManaged: z.boolean(),
  batchId: z.string().uuid().nullable(),
  batchNo: z.string().nullable(),
  expiryDate: z.string().nullable(),
  quantityShipped: z.number().int(),
  /** `null` khi phiếu còn `DRAFT` (chưa Duyệt xuất) hoặc `IN_TRANSIT` (chưa Xác nhận nhận hàng). */
  quantityReceived: z.number().int().nullable(),
  varianceNote: z.string().nullable(),
});
export type StockTransferLine = z.infer<typeof stockTransferLineSchema>;

export const stockTransferSummarySchema = z.object({
  id: z.string().uuid(),
  transferNo: z.string(),
  status: stockTransferStatusSchema,
  fromWarehouseId: z.string().uuid(),
  fromWarehouseName: z.string(),
  toWarehouseId: z.string().uuid(),
  toWarehouseName: z.string(),
  occurredAt: z.string(),
  note: z.string().nullable(),
  lineCount: z.number().int(),
  createdByName: z.string(),
  shippedByName: z.string().nullable(),
  shippedAt: z.string().nullable(),
  receivedByName: z.string().nullable(),
  receivedAt: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  version: z.number().int(),
});
export type StockTransferSummary = z.infer<typeof stockTransferSummarySchema>;

export const stockTransferDetailSchema = stockTransferSummarySchema.extend({ lines: z.array(stockTransferLineSchema) });
export type StockTransferDetail = z.infer<typeof stockTransferDetailSchema>;

export const listStockTransfersQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  fromWarehouseId: z.string().uuid().optional(),
  toWarehouseId: z.string().uuid().optional(),
  status: stockTransferStatusSchema.optional(),
  q: z.string().min(1).max(100).optional(),
});
export type ListStockTransfersQuery = z.infer<typeof listStockTransfersQuerySchema>;

export const listStockTransfersResponseSchema = z.object({
  items: z.array(stockTransferSummarySchema),
  nextCursor: z.string().nullable(),
});
export type ListStockTransfersResponse = z.infer<typeof listStockTransfersResponseSchema>;

// ============ Kho Thuốc GĐ4, "Báo cáo Nhập-Xuất-Tồn" (docs/DECISIONS.md #170, kế hoạch kỹ thuật
// bright-bubbling-axolotl.md mục 5, mockup đã duyệt) — bảng kê Đầu kỳ/Nhập/Xuất/Cuối kỳ theo mặt
// hàng trong khoảng ngày, đúng khuôn "Báo cáo dòng tiền" của Sổ quỹ (`cash-flow-report`). Quyền
// riêng `stock_receipt.report` (chỉ `clinic_admin`, đúng `cash_voucher.report`) — không dùng chung
// `stock_receipt.read` như đề xuất ban đầu trong kế hoạch (đã chốt lại qua AskUserQuestion lúc duyệt
// mockup). ============

export const getStockLedgerReportQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  warehouseId: z.string().uuid().optional(),
  drugId: z.string().uuid().optional(),
});
export type GetStockLedgerReportQuery = z.infer<typeof getStockLedgerReportQuerySchema>;

/** 1 dòng = 1 mặt hàng (không phải 1 chứng từ) — `openingQuantity`/`closingQuantity` tính bằng tổng
 * biến động `stock_ledger` TRƯỚC mốc `from`/sau mốc `to` (2 lần gọi cùng 1 hàm dùng chung, mirror
 * `sumBeforeForAccount()` ở `cash-book-report.service.ts`), KHÔNG dùng `stock_balance` (đó là số dư
 * HIỆN TẠI, không phải số dư tại một mốc thời gian quá khứ bất kỳ). */
export const stockLedgerReportItemSchema = z.object({
  drugId: z.string().uuid(),
  drugCode: z.string(),
  drugName: z.string(),
  unitCode: z.string().nullable(),
  warehouseId: z.string().uuid(),
  warehouseName: z.string(),
  openingQuantity: z.number().int(),
  totalIn: z.number().int(),
  totalOut: z.number().int(),
  closingQuantity: z.number().int(),
});
export type StockLedgerReportItem = z.infer<typeof stockLedgerReportItemSchema>;

export const getStockLedgerReportResponseSchema = z.object({
  items: z.array(stockLedgerReportItemSchema),
  totalOpeningQuantity: z.number().int(),
  totalIn: z.number().int(),
  totalOut: z.number().int(),
  totalClosingQuantity: z.number().int(),
});
export type GetStockLedgerReportResponse = z.infer<typeof getStockLedgerReportResponseSchema>;
