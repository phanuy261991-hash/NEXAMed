import { z } from 'zod';

// ============ Yêu cầu cấp hàng theo cấp (docs/DECISIONS.md #298, mockup chủ dự án duyệt 12/11/2026). Phòng ban xin kho chính của chi nhánh,
// chi nhánh phụ xin chi nhánh chính. Số lượng ở đơn vị CƠ SỞ. Hàng đi bằng Phiếu điều chuyển kho sinh từ yêu cầu. ============

export const stockRequestStatusSchema = z.enum(['DRAFT', 'SUBMITTED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'REJECTED', 'CANCELLED', 'WITHDRAWN']);
export type StockRequestStatus = z.infer<typeof stockRequestStatusSchema>;

export const stockRequestPrioritySchema = z.enum(['NORMAL', 'URGENT']);
export type StockRequestPriority = z.infer<typeof stockRequestPrioritySchema>;

/** Quyết định của kho cấp lưu trên dòng. */
export const stockRequestLineFulfilSchema = z.enum(['PENDING', 'WAITING_STOCK', 'ALLOCATED', 'REJECTED', 'WITHDRAWN']);
export type StockRequestLineFulfil = z.infer<typeof stockRequestLineFulfilSchema>;

/** Trạng thái dòng hiển thị cho cả hai bên (suy ra thêm từ phiếu điều chuyển liên kết). */
export const stockRequestLineDisplayStatusSchema = z.enum(['PENDING', 'WAITING_STOCK', 'REJECTED', 'WITHDRAWN', 'WILL_SUPPLY', 'IN_TRANSIT', 'VARIANCE_PENDING', 'RETURNING', 'RECEIVED']);
export type StockRequestLineDisplayStatus = z.infer<typeof stockRequestLineDisplayStatusSchema>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày phải có dạng YYYY-MM-DD.');
const reasonText = (message: string) => z.string().trim().min(1, message).max(500);

export const stockRequestLineInputSchema = z.object({
  drugId: z.string().uuid(),
  requestedQty: z.number().int().positive('Số xin phải lớn hơn 0.'),
  lineNote: z.string().trim().max(500).nullable().optional(),
});
export type StockRequestLineInput = z.infer<typeof stockRequestLineInputSchema>;

function checkUniqueDrugs(v: { lines: { drugId: string }[] }, ctx: z.RefinementCtx): void {
  const seen = new Set<string>();
  v.lines.forEach((line, index) => {
    if (seen.has(line.drugId)) ctx.addIssue({ code: 'custom', message: 'Mỗi mặt hàng chỉ có một dòng trên phiếu.', path: ['lines', index, 'drugId'] });
    seen.add(line.drugId);
  });
}

const stockRequestHeaderFieldsSchema = z.object({
  requestingWarehouseId: z.string().uuid(),
  priority: stockRequestPrioritySchema.default('NORMAL'),
  neededBy: isoDate.nullable().optional(),
  note: z.string().trim().max(1000).nullable().optional(),
  lines: z.array(stockRequestLineInputSchema).min(1, 'Phải có ít nhất 1 mặt hàng.'),
});

/** `POST /inventory/requests` — `submit=true` gửi luôn, `false` lưu nháp. Kho cấp do máy chủ suy ra theo cấp, người dùng không chọn. */
export const createStockRequestRequestSchema = stockRequestHeaderFieldsSchema.extend({ submit: z.boolean().default(false) }).superRefine(checkUniqueDrugs);
export type CreateStockRequestRequest = z.infer<typeof createStockRequestRequestSchema>;

/** `PATCH /inventory/requests/:id` — sửa tự do khi còn Nháp/Đã gửi (kho cấp chưa tiếp nhận); thay toàn bộ dòng. */
export const updateStockRequestRequestSchema = stockRequestHeaderFieldsSchema.extend({ version: z.number().int() }).superRefine(checkUniqueDrugs);
export type UpdateStockRequestRequest = z.infer<typeof updateStockRequestRequestSchema>;

export const versionedStockRequestRequestSchema = z.object({ version: z.number().int() });
export type VersionedStockRequestRequest = z.infer<typeof versionedStockRequestRequestSchema>;

export const cancelStockRequestRequestSchema = z.object({ reason: reasonText('Phải nhập lý do huỷ.'), version: z.number().int() });
export type CancelStockRequestRequest = z.infer<typeof cancelStockRequestRequestSchema>;

export const rejectStockRequestRequestSchema = z.object({ reason: reasonText('Phải nhập lý do từ chối.'), version: z.number().int() });
export type RejectStockRequestRequest = z.infer<typeof rejectStockRequestRequestSchema>;

/** Nhắn bổ sung / đổi mức khẩn / đổi ngày cần — làm được cả sau khi kho cấp đã tiếp nhận. Phải đổi ít nhất một thứ. */
export const updateStockRequestNoteRequestSchema = z
  .object({
    version: z.number().int(),
    message: z.string().trim().max(1000).optional(),
    priority: stockRequestPrioritySchema.optional(),
    neededBy: isoDate.nullable().optional(),
  })
  .refine((v) => v.message !== undefined || v.priority !== undefined || v.neededBy !== undefined, { message: 'Phải nhập tin nhắn hoặc đổi mức khẩn/ngày cần.' });
export type UpdateStockRequestNoteRequest = z.infer<typeof updateStockRequestNoteRequestSchema>;

/** Thêm mặt hàng vào phiếu ĐÃ tiếp nhận mà chưa cấp dòng nào — kho cấp được báo. */
export const addStockRequestLinesRequestSchema = z
  .object({ lines: z.array(stockRequestLineInputSchema).min(1, 'Phải có ít nhất 1 mặt hàng.'), version: z.number().int() })
  .superRefine(checkUniqueDrugs);
export type AddStockRequestLinesRequest = z.infer<typeof addStockRequestLinesRequestSchema>;

/** Rút dòng chưa có hàng — lý do bắt buộc. */
export const withdrawStockRequestLinesRequestSchema = z.object({
  lineIds: z.array(z.string().uuid()).min(1, 'Chọn ít nhất 1 dòng để rút.'),
  reason: reasonText('Phải nhập lý do rút.'),
  version: z.number().int(),
});
export type WithdrawStockRequestLinesRequest = z.infer<typeof withdrawStockRequestLinesRequestSchema>;

/** Quyết định cho phần CHƯA cấp của một dòng: chờ hàng về hoặc từ chối, cả hai bắt buộc lý do. */
export const stockRequestRemainderSchema = z.object({
  action: z.enum(['WAIT', 'REJECT']),
  reason: reasonText('Phải nhập lý do cho phần chưa cấp.'),
  expectedDate: isoDate.nullable().optional(),
  /** Đơn đặt hàng NCC mà phần chờ này đang chờ (tuỳ chọn, chỉ khi `action='WAIT'`; #298 giai đoạn 2). */
  purchaseOrderId: z.string().uuid().nullable().optional(),
  /** Phiếu yêu cầu cấp hàng xin PHẦN THIẾU lên cấp trên mà phần chờ này đang chờ (tuỳ chọn, chỉ khi `action='WAIT'`; mockup màn 5). */
  childRequestId: z.string().uuid().nullable().optional(),
});
export type StockRequestRemainder = z.infer<typeof stockRequestRemainderSchema>;

export const allocateStockRequestLineSchema = z.object({
  lineId: z.string().uuid(),
  /** Số cấp lần này (0 đến số còn thiếu). */
  allocateQty: z.number().int().min(0),
  /** Bắt buộc khi sau lần này dòng vẫn còn thiếu; bỏ trống nghĩa là cấp đủ. */
  remainder: stockRequestRemainderSchema.nullable().optional(),
});
export type AllocateStockRequestLine = z.infer<typeof allocateStockRequestLineSchema>;

/** `POST /inventory/requests/:id/allocate` — "Chuyển thành phiếu điều chuyển": cấp số đã chọn thành MỘT phiếu điều chuyển nháp + ghi quyết định phần còn thiếu. Cũng dùng cho "Cấp tiếp". */
export const allocateStockRequestRequestSchema = z.object({
  version: z.number().int(),
  lines: z.array(allocateStockRequestLineSchema).min(1),
});
export type AllocateStockRequestRequest = z.infer<typeof allocateStockRequestRequestSchema>;

/** `POST /inventory/requests/:id/escalate` — "Xin phần thiếu lên cấp trên": tạo phiếu con xin đúng phần còn thiếu của các dòng đã chọn. */
export const escalateStockRequestRequestSchema = z.object({
  lineIds: z.array(z.string().uuid()).min(1, 'Chọn ít nhất 1 dòng.'),
  version: z.number().int(),
});
export type EscalateStockRequestRequest = z.infer<typeof escalateStockRequestRequestSchema>;

const stockRequestTransferRefSchema = z.object({
  id: z.string().uuid(),
  transferNo: z.string(),
  status: z.enum(['DRAFT', 'IN_TRANSIT', 'COMPLETED', 'REJECTED', 'VARIANCE_PENDING', 'RETURNING', 'RETURNED']),
  lineCount: z.number().int(),
  fromBranchName: z.string(),
  toBranchName: z.string(),
  fromWarehouseName: z.string(),
  toWarehouseName: z.string(),
  /** Người xem mở được chi tiết phiếu điều chuyển này không (chi nhánh nhận chỉ thấy từ lúc đã giao; chi nhánh khác không liên quan thì không). */
  canOpen: z.boolean(),
});
export type StockRequestTransferRef = z.infer<typeof stockRequestTransferRefSchema>;

export const stockRequestLineSchema = z.object({
  id: z.string().uuid(),
  drugId: z.string().uuid(),
  drugCode: z.string(),
  drugName: z.string(),
  /** Đơn vị cơ sở. */
  unitCode: z.string().nullable(),
  requestedQty: z.number().int(),
  /** Tồn của kho xin lúc gửi (chỉ số lượng). */
  requesterStockSnapshot: z.number().int().nullable(),
  /** Tồn hiện tại của kho cấp — chỉ gửi cho bên cấp, bên xin nhận `null`. */
  supplierStock: z.number().int().nullable(),
  lineNote: z.string().nullable(),
  fulfilStatus: stockRequestLineFulfilSchema,
  displayStatus: stockRequestLineDisplayStatusSchema,
  allocatedQty: z.number().int(),
  receivedQty: z.number().int(),
  remainingQty: z.number().int(),
  decisionReason: z.string().nullable(),
  waitExpectedDate: z.string().nullable(),
  waitChildRequestId: z.string().uuid().nullable(),
  waitChildRequestNo: z.string().nullable(),
  /** Đơn đặt hàng NCC mà dòng chờ hàng về đang chờ (#298 giai đoạn 2). */
  waitPurchaseOrderId: z.string().uuid().nullable(),
  waitPurchaseOrderNo: z.string().nullable(),
  waitPurchaseOrderStatus: z.enum(['DRAFT', 'PENDING_APPROVAL', 'REJECTED', 'APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED']).nullable(),
  /** Bên xin đã gửi "Yêu cầu rút" (đơn đã đặt NCC) và đang chờ kho cấp xác nhận. */
  withdrawRequestedAt: z.string().nullable(),
  withdrawRequestReason: z.string().nullable(),
  addedAfterAccept: z.boolean(),
  withdrawReason: z.string().nullable(),
  withdrawnAt: z.string().nullable(),
  transfers: z.array(z.object({ id: z.string().uuid(), transferNo: z.string(), status: stockRequestTransferRefSchema.shape.status })),
});
export type StockRequestLine = z.infer<typeof stockRequestLineSchema>;

export const stockRequestEventSchema = z.object({
  id: z.string().uuid(),
  eventType: z.string(),
  actorName: z.string(),
  occurredAt: z.string(),
  /** Tiêu đề ngắn của mốc ("Đã gửi", "Cấp đợt 1: tạo PDC..."). */
  message: z.string().nullable(),
  /** Dòng phụ dưới tiêu đề ("3 dòng. 1 dòng từ chối..."); trống thì hiện tên người thực hiện. */
  detail: z.string().nullable(),
});
export type StockRequestEvent = z.infer<typeof stockRequestEventSchema>;

export const stockRequestSummarySchema = z.object({
  id: z.string().uuid(),
  requestNo: z.string(),
  status: stockRequestStatusSchema,
  priority: stockRequestPrioritySchema,
  neededBy: z.string().nullable(),
  note: z.string().nullable(),
  requestingWarehouseId: z.string().uuid(),
  requestingWarehouseName: z.string(),
  requestingBranchId: z.string().uuid(),
  requestingBranchName: z.string(),
  supplyingWarehouseId: z.string().uuid(),
  supplyingWarehouseName: z.string(),
  supplyingBranchId: z.string().uuid(),
  supplyingBranchName: z.string(),
  lineCount: z.number().int(),
  createdByName: z.string(),
  createdAt: z.string(),
  submittedAt: z.string().nullable(),
  acceptedByName: z.string().nullable(),
  acceptedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  cancellationReason: z.string().nullable(),
  supplierUpdatePending: z.boolean(),
  parentRequestId: z.string().uuid().nullable(),
  parentRequestNo: z.string().nullable(),
  /** "Hàng đã về": phiếu có dòng chờ hàng về mà kho cấp nay đủ tồn — chỉ tính cho bên cấp. */
  readyToSupply: z.boolean(),
  /** Tên Khoa/Phòng của kho xin — cột "Người xin" của tab Cần duyệt (mockup màn 2). */
  requestingDepartmentName: z.string().nullable(),
  /** Tiến độ cấp (mockup màn 2): số dòng đang còn hiệu lực (không tính dòng đã rút), trong đó đã cấp / đang chờ hàng về / chưa xử lý; ngày dự kiến sớm nhất của các dòng chờ hàng về. */
  activeLineCount: z.number().int(),
  allocatedLineCount: z.number().int(),
  waitingLineCount: z.number().int(),
  pendingLineCount: z.number().int(),
  earliestWaitDate: z.string().nullable(),
  version: z.number().int(),
});
export type StockRequestSummary = z.infer<typeof stockRequestSummarySchema>;

export const stockRequestDetailSchema = stockRequestSummarySchema.extend({
  lines: z.array(stockRequestLineSchema),
  events: z.array(stockRequestEventSchema),
  transfers: z.array(stockRequestTransferRefSchema),
  /** Các phiếu xin phần thiếu lên cấp trên (sinh từ phiếu này) còn mở — để kho cấp chọn "đang chờ phiếu đó" ở hộp Chờ hàng về (mockup màn 5). */
  childRequests: z.array(z.object({ id: z.string().uuid(), requestNo: z.string(), status: stockRequestStatusSchema, supplyingWarehouseName: z.string(), supplyingBranchName: z.string() })),
  /** Người xem thuộc phía nào (theo chi nhánh + Khoa/Phòng): quyết định hiện nút của bên xin hay của kho cấp. */
  canActAsRequester: z.boolean(),
  canActAsSupplier: z.boolean(),
  /** Kho cấp còn cấp trên để "Xin phần thiếu" hay không. */
  canEscalate: z.boolean(),
});
export type StockRequestDetail = z.infer<typeof stockRequestDetailSchema>;

export const listStockRequestsQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  /** `mine` = phiếu của kho thuộc chi nhánh đang làm (bên xin); `incoming` = phiếu xin kho của chi nhánh này (bên cấp, từ lúc đã gửi). */
  view: z.enum(['mine', 'incoming']).default('mine'),
  status: stockRequestStatusSchema.optional(),
  priority: stockRequestPrioritySchema.optional(),
  /** Lọc theo kho xin (cả hai tab, mockup màn 2). */
  warehouseId: z.string().uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  q: z.string().trim().min(1).max(100).optional(),
});
export type ListStockRequestsQuery = z.infer<typeof listStockRequestsQuerySchema>;

export const listStockRequestsResponseSchema = z.object({
  items: z.array(stockRequestSummarySchema),
  nextCursor: z.string().nullable(),
  /** Đếm theo trạng thái (áp mọi bộ lọc TRỪ trạng thái) — dải đếm trên đầu danh sách. */
  statusCounts: z.partialRecord(stockRequestStatusSchema, z.number().int().nonnegative()),
});
export type ListStockRequestsResponse = z.infer<typeof listStockRequestsResponseSchema>;

/** Chấm số trên menu: phiếu chờ kho này tiếp nhận + phiếu bên xin vừa cập nhật. */
export const getStockRequestPendingCountsResponseSchema = z.object({
  toAccept: z.number().int().nonnegative(),
  updated: z.number().int().nonnegative(),
  /** Phiếu có dòng chờ hàng về mà kho cấp nay đủ tồn ("Hàng đã về", chờ bấm Cấp tiếp). */
  ready: z.number().int().nonnegative(),
  /** Số phiếu KHÁC NHAU cần kho cấp làm gì đó (chờ tiếp nhận, hàng đã về hoặc bên xin vừa cập nhật) — một phiếu thuộc nhiều nhóm chỉ đếm một lần. */
  actionable: z.number().int().nonnegative(),
});
export type GetStockRequestPendingCountsResponse = z.infer<typeof getStockRequestPendingCountsResponseSchema>;

export const stockRequestOptionSchema = z.object({
  requestingWarehouseId: z.string().uuid(),
  requestingWarehouseName: z.string(),
  supplyingWarehouseId: z.string().uuid(),
  supplyingWarehouseName: z.string(),
  supplyingBranchId: z.string().uuid(),
  supplyingBranchName: z.string(),
});
export type StockRequestOption = z.infer<typeof stockRequestOptionSchema>;

/** `GET /inventory/requests/options` — mọi kho người dùng được phép xin kèm kho cấp suy ra theo cấp. */
export const getStockRequestOptionsResponseSchema = z.object({ options: z.array(stockRequestOptionSchema) });
export type GetStockRequestOptionsResponse = z.infer<typeof getStockRequestOptionsResponseSchema>;

export const getStockRequestLowStockQuerySchema = z.object({ warehouseId: z.string().uuid() });
export type GetStockRequestLowStockQuery = z.infer<typeof getStockRequestLowStockQuerySchema>;

export const stockRequestLowStockItemSchema = z.object({
  drugId: z.string().uuid(),
  drugCode: z.string(),
  drugName: z.string(),
  unitCode: z.string().nullable(),
  onHand: z.number().int(),
  minStock: z.number().int(),
  /** Gợi ý số xin để về tới mức tối thiểu — người dùng sửa trước khi gửi. */
  suggestedQty: z.number().int(),
});
export type StockRequestLowStockItem = z.infer<typeof stockRequestLowStockItemSchema>;

export const getStockRequestLowStockResponseSchema = z.object({ items: z.array(stockRequestLowStockItemSchema) });
export type GetStockRequestLowStockResponse = z.infer<typeof getStockRequestLowStockResponseSchema>;

/** Kết quả "Xin phần thiếu": phiếu con vừa tạo. */
export const escalateStockRequestResponseSchema = z.object({ child: stockRequestDetailSchema, parent: stockRequestDetailSchema });
export type EscalateStockRequestResponse = z.infer<typeof escalateStockRequestResponseSchema>;

/** Một mặt hàng ở tab "Hàng cần bổ sung" (mockup màn 4): tồn và mức tối thiểu của kho chính chi nhánh, số các phòng ban đang chờ cấp, số gợi ý cần bổ sung. */
export const stockRequestRestockItemSchema = z.object({
  drugId: z.string().uuid(),
  drugCode: z.string(),
  drugName: z.string(),
  unitCode: z.string().nullable(),
  onHand: z.number().int(),
  minStock: z.number().int(),
  /** Tổng số các phiếu yêu cầu của phòng ban đang chờ kho này cấp (chưa giao), cùng đơn vị cơ sở. */
  deptWaitingQty: z.number().int(),
  deptWaitingRequestNos: z.array(z.string()),
  /** Gợi ý = mức tối thiểu trừ tồn cộng phần phòng ban đang chờ; người dùng sửa trước khi xin/đặt. */
  suggestedQty: z.number().int(),
});
export type StockRequestRestockItem = z.infer<typeof stockRequestRestockItemSchema>;

/** `GET /inventory/requests/restock` — tab "Hàng cần bổ sung" của kho chính chi nhánh đang làm. */
export const getStockRequestRestockResponseSchema = z.object({
  warehouseId: z.string().uuid().nullable(),
  warehouseName: z.string().nullable(),
  /** Kho chính này có kho cấp trên để "Xin chi nhánh chính" không. */
  canRequestUp: z.boolean(),
  stats: z.object({
    belowMin: z.number().int().nonnegative(),
    deptWaiting: z.number().int().nonnegative(),
    waitingArrival: z.number().int().nonnegative(),
    requestedUp: z.number().int().nonnegative(),
  }),
  items: z.array(stockRequestRestockItemSchema),
});
export type GetStockRequestRestockResponse = z.infer<typeof getStockRequestRestockResponseSchema>;
