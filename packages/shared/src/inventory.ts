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
