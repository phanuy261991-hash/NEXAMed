import { z } from 'zod';

// ============ Đơn đặt hàng NCC (docs/DECISIONS.md #298 giai đoạn 2, mockup chủ dự án duyệt 12/11/2026). Chứng từ đặt hàng với nhà cung cấp theo kho nhận (kho thuộc một chi nhánh);
// nhận hàng bằng Phiếu nhập kho liên kết (nhiều đợt), số đã nhận suy ra từ các phiếu nhập ĐÃ DUYỆT. Số lượng + đơn giá dự kiến theo ĐÚNG đơn vị đã chọn ở dòng đơn. ============

export const purchaseOrderStatusSchema = z.enum(['DRAFT', 'PENDING_APPROVAL', 'REJECTED', 'APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED']);
export type PurchaseOrderStatus = z.infer<typeof purchaseOrderStatusSchema>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày phải có dạng YYYY-MM-DD.');
const reasonText = (message: string) => z.string().trim().min(1, message).max(500);

export const purchaseOrderLineInputSchema = z.object({
  drugId: z.string().uuid(),
  unitCode: z.string().min(1, 'Phải chọn đơn vị.'),
  quantity: z.number().int().positive('Số đặt phải lớn hơn 0.'),
  /** Đơn giá dự kiến theo `unitCode` — tuỳ chọn, chỉ để người duyệt cân đối ngân sách. */
  expectedUnitCost: z.number().int().nonnegative().nullable().optional(),
  lineNote: z.string().trim().max(500).nullable().optional(),
  /** Dòng yêu cầu cấp hàng đang chờ hàng về mà dòng đơn này đáp ứng (tuỳ chọn) — máy chủ gắn `wait_purchase_order_id` cho dòng đó. */
  sourceRequestLineId: z.string().uuid().nullable().optional(),
});
export type PurchaseOrderLineInput = z.infer<typeof purchaseOrderLineInputSchema>;

function checkUniqueDrugs(v: { lines: { drugId: string }[] }, ctx: z.RefinementCtx): void {
  const seen = new Set<string>();
  v.lines.forEach((line, index) => {
    if (seen.has(line.drugId)) ctx.addIssue({ code: 'custom', message: 'Mỗi mặt hàng chỉ có một dòng trên đơn.', path: ['lines', index, 'drugId'] });
    seen.add(line.drugId);
  });
}

const purchaseOrderHeaderFieldsSchema = z.object({
  supplierId: z.string().uuid(),
  warehouseId: z.string().uuid(),
  expectedDate: isoDate.nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
  lines: z.array(purchaseOrderLineInputSchema).min(1, 'Phải có ít nhất 1 mặt hàng.'),
});

/** `POST /inventory/purchase-orders` — lưu Nháp. Gửi duyệt / duyệt / đặt NCC là các thao tác riêng. */
export const createPurchaseOrderRequestSchema = purchaseOrderHeaderFieldsSchema.superRefine(checkUniqueDrugs);
export type CreatePurchaseOrderRequest = z.infer<typeof createPurchaseOrderRequestSchema>;

/** `PATCH /inventory/purchase-orders/:id` — sửa tự do khi còn Nháp hoặc đã bị Từ chối (thay toàn bộ dòng). */
export const updatePurchaseOrderRequestSchema = purchaseOrderHeaderFieldsSchema.extend({ version: z.number().int() }).superRefine(checkUniqueDrugs);
export type UpdatePurchaseOrderRequest = z.infer<typeof updatePurchaseOrderRequestSchema>;

export const versionedPurchaseOrderRequestSchema = z.object({ version: z.number().int() });
export type VersionedPurchaseOrderRequest = z.infer<typeof versionedPurchaseOrderRequestSchema>;

export const rejectPurchaseOrderRequestSchema = z.object({ reason: reasonText('Phải nhập lý do từ chối.'), version: z.number().int() });
export type RejectPurchaseOrderRequest = z.infer<typeof rejectPurchaseOrderRequestSchema>;

export const cancelPurchaseOrderRequestSchema = z.object({ reason: reasonText('Phải nhập lý do huỷ.'), version: z.number().int() });
export type CancelPurchaseOrderRequest = z.infer<typeof cancelPurchaseOrderRequestSchema>;

/** Đóng đơn khi nhà cung cấp không giao nữa — lý do bắt buộc, phần còn thiếu không nhận nữa. */
export const closePurchaseOrderRequestSchema = z.object({ reason: reasonText('Phải nhập lý do đóng đơn.'), version: z.number().int() });
export type ClosePurchaseOrderRequest = z.infer<typeof closePurchaseOrderRequestSchema>;

export const purchaseOrderLineSchema = z.object({
  id: z.string().uuid(),
  drugId: z.string().uuid(),
  drugCode: z.string(),
  drugName: z.string(),
  unitCode: z.string(),
  quantity: z.number().int(),
  expectedUnitCost: z.number().int().nullable(),
  /** `quantity × expectedUnitCost`; 0 khi chưa nhập đơn giá. */
  lineAmount: z.number().int(),
  lineNote: z.string().nullable(),
  /** Đã nhận = tổng số lượng các dòng phiếu nhập ĐÃ DUYỆT gắn dòng này (cùng đơn vị với dòng đơn). */
  receivedQty: z.number().int(),
  remainingQty: z.number().int(),
  /** Yêu cầu cấp hàng đang chờ hàng của đơn này, cùng mặt hàng (nhãn "Nguồn" ở màn lập đơn). */
  sourceRequests: z.array(z.object({ id: z.string().uuid(), requestNo: z.string() })),
});
export type PurchaseOrderLine = z.infer<typeof purchaseOrderLineSchema>;

export const purchaseOrderReceiptRefSchema = z.object({
  id: z.string().uuid(),
  receiptNo: z.string(),
  status: z.enum(['DRAFT', 'POSTED', 'REJECTED']),
  occurredAt: z.string(),
  lineCount: z.number().int(),
  voided: z.boolean(),
});
export type PurchaseOrderReceiptRef = z.infer<typeof purchaseOrderReceiptRefSchema>;

export const purchaseOrderSummarySchema = z.object({
  id: z.string().uuid(),
  orderNo: z.string(),
  status: purchaseOrderStatusSchema,
  supplierId: z.string().uuid(),
  supplierName: z.string(),
  warehouseId: z.string().uuid(),
  warehouseName: z.string(),
  branchId: z.string().uuid(),
  branchName: z.string(),
  expectedDate: z.string().nullable(),
  note: z.string().nullable(),
  /** Tổng dự kiến (chỉ tính dòng có đơn giá). */
  totalAmount: z.number().int(),
  lineCount: z.number().int(),
  /** Số dòng đã nhận đủ — "3 / 6 dòng". */
  receivedLineCount: z.number().int(),
  /** Số phiếu nhập liên kết còn Nháp ("1 phiếu nhập đang soạn"). */
  draftReceiptCount: z.number().int(),
  createdByName: z.string(),
  createdAt: z.string(),
  submittedAt: z.string().nullable(),
  approvedAt: z.string().nullable(),
  approvedByName: z.string().nullable(),
  orderedAt: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  cancellationReason: z.string().nullable(),
  closedReason: z.string().nullable(),
  /** Đơn này cần chi nhánh CHÍNH duyệt (công tắc bật VÀ kho nhận thuộc chi nhánh phụ). */
  requiresMainApproval: z.boolean(),
  version: z.number().int(),
});
export type PurchaseOrderSummary = z.infer<typeof purchaseOrderSummarySchema>;

export const purchaseOrderDetailSchema = purchaseOrderSummarySchema.extend({
  lines: z.array(purchaseOrderLineSchema),
  receipts: z.array(purchaseOrderReceiptRefSchema),
  /** Người xem có đứng đúng phía duyệt không (chi nhánh chính nếu đơn cần chi nhánh chính duyệt, ngược lại là chi nhánh của đơn). */
  canActAsApprover: z.boolean(),
  /** Người xem thuộc chi nhánh của đơn (khác `false` khi chi nhánh chính mở đơn chờ duyệt của chi nhánh phụ — chỉ xem + duyệt/từ chối). */
  isOwnBranch: z.boolean(),
  /** Cho phép nhận vượt số đặt (công tắc) — web dùng để khoá/mở ô số nhận. */
  allowOverReceipt: z.boolean(),
});
export type PurchaseOrderDetail = z.infer<typeof purchaseOrderDetailSchema>;

export const listPurchaseOrdersQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  /** `mine` = đơn của chi nhánh đang làm; `approval` = đơn CHỜ DUYỆT của chi nhánh khác mà chi nhánh chính phải duyệt. */
  view: z.enum(['mine', 'approval']).default('mine'),
  status: purchaseOrderStatusSchema.optional(),
  supplierId: z.string().uuid().optional(),
  warehouseId: z.string().uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  q: z.string().trim().min(1).max(100).optional(),
});
export type ListPurchaseOrdersQuery = z.infer<typeof listPurchaseOrdersQuerySchema>;

export const listPurchaseOrdersResponseSchema = z.object({
  items: z.array(purchaseOrderSummarySchema),
  nextCursor: z.string().nullable(),
  /** Đếm theo trạng thái (áp mọi bộ lọc TRỪ trạng thái) — dải đếm trên đầu danh sách. */
  statusCounts: z.partialRecord(purchaseOrderStatusSchema, z.number().int().nonnegative()),
});
export type ListPurchaseOrdersResponse = z.infer<typeof listPurchaseOrdersResponseSchema>;

export const getPurchaseOrderPendingCountsResponseSchema = z.object({ toApprove: z.number().int().nonnegative() });
export type GetPurchaseOrderPendingCountsResponse = z.infer<typeof getPurchaseOrderPendingCountsResponseSchema>;

/** `GET /inventory/purchase-orders/options` — cờ cấu hình + chi nhánh hiện tại để web ẩn/hiện menu và dải "cần duyệt". */
export const getPurchaseOrderOptionsResponseSchema = z.object({
  /** Chi nhánh đang làm được lập đơn (chi nhánh chính luôn được; chi nhánh phụ khi công tắc đặt hàng riêng BẬT). */
  canOrderHere: z.boolean(),
  /** Đơn của chi nhánh đang làm cần chi nhánh chính duyệt. */
  requiresMainApproval: z.boolean(),
  /** Chi nhánh đang làm là chi nhánh chính. */
  isMainBranch: z.boolean(),
  allowOverReceipt: z.boolean(),
});
export type GetPurchaseOrderOptionsResponse = z.infer<typeof getPurchaseOrderOptionsResponseSchema>;

/** `GET /inventory/purchase-orders/settings` — 3 công tắc tự-phục vụ để web ẩn/hiện menu (khuôn `stockRequestFeatureStatusSchema`). */
export const purchaseOrderSettingsSchema = z.object({
  branchPurchasingEnabled: z.boolean(),
  branchPurchaseNeedsMainApproval: z.boolean(),
  allowOverReceipt: z.boolean(),
});
export type PurchaseOrderSettings = z.infer<typeof purchaseOrderSettingsSchema>;

/** Mặc định đã chốt 12/11/2026: chi nhánh đặt riêng BẬT, cần chi nhánh chính duyệt TẮT, nhận vượt TẮT. */
export const DEFAULT_PURCHASE_ORDER_SETTINGS: PurchaseOrderSettings = {
  branchPurchasingEnabled: true,
  branchPurchaseNeedsMainApproval: false,
  allowOverReceipt: false,
};

/** `POST /inventory/requests/:id/withdraw-requests/resolve` — kho cấp xác nhận hoặc từ chối "Yêu cầu rút" của bên xin (dòng chờ hàng về đã gắn đơn đã đặt NCC). */
export const resolveStockRequestWithdrawRequestSchema = z.object({
  lineIds: z.array(z.string().uuid()).min(1, 'Chọn ít nhất 1 dòng.'),
  action: z.enum(['CONFIRM', 'DECLINE']),
  note: z.string().trim().max(500).nullable().optional(),
  version: z.number().int(),
});
export type ResolveStockRequestWithdrawRequest = z.infer<typeof resolveStockRequestWithdrawRequestSchema>;
