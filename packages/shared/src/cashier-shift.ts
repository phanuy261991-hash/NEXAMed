import { z } from 'zod';

/**
 * "Chốt ca" (đối soát tiền mặt/két, ngoài kế hoạch, mockup duyệt 2026-09-03) — module
 * `cashier-shift`. KHÔNG liên quan `work-shift`/`work-shift-assignment` (đăng ký ca làm việc nhân
 * viên, #101) dù tên gần giống — đây là phiên làm việc CỦA KÉT TIỀN MẶT (mở/đóng/đối soát). v1:
 * 1 két dùng chung toàn tenant, chỉ 1 ca OPEN tại một thời điểm (xem migration
 * `20260903180000_cashier_shift`, partial unique index).
 */

/** Prefix mã hiển thị `shift_no` (Phiếu Chốt Ca) — cùng khuôn `patient_code`/`invoice_no`. */
export const CASHIER_SHIFT_NO_PREFIX = 'PCC';

export const cashierShiftStatusSchema = z.enum(['OPEN', 'CLOSED', 'APPROVED']);
export type CashierShiftStatus = z.infer<typeof cashierShiftStatusSchema>;

export const cashierShiftDiscrepancyResolutionSchema = z.enum(['DEDUCT', 'INCOME', 'WAIVE']);
export type CashierShiftDiscrepancyResolution = z.infer<typeof cashierShiftDiscrepancyResolutionSchema>;

export const nonCashBreakdownItemSchema = z.object({
  method: z.string(),
  methodLabel: z.string(),
  count: z.number().int(),
  amount: z.number().int(),
});
export type NonCashBreakdownItem = z.infer<typeof nonCashBreakdownItemSchema>;

/**
 * "Tổng kết hệ thống" (bước 1 wizard Chốt ca) — dùng cho cả `GET .../summary` (preview SỐNG lúc
 * đang mở ca) lẫn `GET .../resync-preview` (Quản lý xem trước "Tính toán lại" sau khi chốt).
 * Nguồn: `computeCashierShiftTotals()` ở `@nexamed/core`.
 */
export const cashierShiftSummarySchema = z.object({
  cashInAmount: z.number().int(),
  cashInCount: z.number().int(),
  cashOutAmount: z.number().int(),
  cashOutCount: z.number().int(),
  nonCashBreakdown: z.array(nonCashBreakdownItemSchema),
  /** = openingFloatActual + cashInAmount - cashOutAmount. */
  expectedCashAmount: z.number().int(),
});
export type CashierShiftSummary = z.infer<typeof cashierShiftSummarySchema>;

export const cashierShiftDetailSchema = z.object({
  id: z.string().uuid(),
  shiftNo: z.string(),
  cashierId: z.string().uuid(),
  cashierName: z.string(),
  shiftLabel: z.string(),
  status: cashierShiftStatusSchema,
  openedAt: z.string(),
  openingFloatExpected: z.number().int().nullable(),
  openingFloatActual: z.number().int(),
  openingDiscrepancyReason: z.string().nullable(),
  closedAt: z.string().nullable(),
  cashInAmount: z.number().int().nullable(),
  cashOutAmount: z.number().int().nullable(),
  nonCashBreakdown: z.array(nonCashBreakdownItemSchema),
  expectedCashAmount: z.number().int().nullable(),
  countedCashAmount: z.number().int().nullable(),
  cashDiscrepancyReason: z.string().nullable(),
  keepForNextAmount: z.number().int().nullable(),
  submittedAmount: z.number().int().nullable(),
  handoverNote: z.string().nullable(),
  resolutionMethod: cashierShiftDiscrepancyResolutionSchema.nullable(),
  resolutionNote: z.string().nullable(),
  resolvedByName: z.string().nullable(),
  resolvedAt: z.string().nullable(),
  approvedByName: z.string().nullable(),
  approvedAt: z.string().nullable(),
  editedByName: z.string().nullable(),
  editedAt: z.string().nullable(),
  version: z.number().int(),
});
export type CashierShiftDetail = z.infer<typeof cashierShiftDetailSchema>;

/**
 * `GET /cashier-shifts/current` — ca đang OPEN (nếu có, của actor với scope personal) +
 * gợi ý vốn đầu ca cho lần Mở ca tiếp theo (ca CLOSED gần nhất TOÀN TENANT, bất kỳ ai — v1 chỉ 1
 * két dùng chung, xem migration). Dùng để trigger popup Mở ca ở `InvoiceListPage.tsx`.
 */
export const currentCashierShiftResponseSchema = z.object({
  openShift: cashierShiftDetailSchema.nullable(),
  previousClosedShift: z
    .object({
      shiftNo: z.string(),
      cashierName: z.string(),
      shiftLabel: z.string(),
      closedAt: z.string(),
      keepForNextAmount: z.number().int(),
    })
    .nullable(),
});
export type CurrentCashierShiftResponse = z.infer<typeof currentCashierShiftResponseSchema>;

export const openCashierShiftRequestSchema = z.object({
  openingFloatActual: z.number().int().nonnegative(),
  openingDiscrepancyReason: z.string().optional(),
});
export type OpenCashierShiftRequest = z.infer<typeof openCashierShiftRequestSchema>;

export const closeCashierShiftRequestSchema = z.object({
  countedCashAmount: z.number().int().nonnegative(),
  cashDiscrepancyReason: z.string().optional(),
  keepForNextAmount: z.number().int().nonnegative(),
  handoverNote: z.string().optional(),
  version: z.number().int(),
});
export type CloseCashierShiftRequest = z.infer<typeof closeCashierShiftRequestSchema>;

/** `dateFrom`/`dateTo` — `YYYY-MM-DD`, giờ Việt Nam, cùng quy ước `listBillingInvoicesQuerySchema`. */
export const listCashierShiftsQuerySchema = z.object({
  dateFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  dateTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  cashierId: z.string().uuid().optional(),
  status: z.enum(['ok', 'bad']).optional(),
});
export type ListCashierShiftsQuery = z.infer<typeof listCashierShiftsQuerySchema>;

export const cashierShiftListItemSchema = z.object({
  id: z.string().uuid(),
  shiftNo: z.string(),
  cashierName: z.string(),
  shiftLabel: z.string(),
  openedAt: z.string(),
  closedAt: z.string().nullable(),
  expectedCashAmount: z.number().int().nullable(),
  countedCashAmount: z.number().int().nullable(),
  submittedAmount: z.number().int().nullable(),
  /** = countedCashAmount - expectedCashAmount, 0 khi chưa chốt. */
  cashDiscrepancyAmount: z.number().int(),
  status: cashierShiftStatusSchema,
  editedAt: z.string().nullable(),
});
export type CashierShiftListItem = z.infer<typeof cashierShiftListItemSchema>;

export const listCashierShiftsResponseSchema = z.object({
  items: z.array(cashierShiftListItemSchema),
  totalCount: z.number().int(),
  totalSubmittedAmount: z.number().int(),
  pendingApprovalCount: z.number().int(),
  discrepancyCount: z.number().int(),
  discrepancyTotalAmount: z.number().int(),
});
export type ListCashierShiftsResponse = z.infer<typeof listCashierShiftsResponseSchema>;

/** `POST /cashier-shifts/:id/approve` — quyền `cashier_shift.manage`. */
export const approveCashierShiftRequestSchema = z.object({
  version: z.number().int(),
});
export type ApproveCashierShiftRequest = z.infer<typeof approveCashierShiftRequestSchema>;

/** `POST /cashier-shifts/:id/resolve-discrepancy` — quyền `cashier_shift.manage`. */
export const resolveCashierShiftDiscrepancyRequestSchema = z.object({
  method: cashierShiftDiscrepancyResolutionSchema,
  note: z.string().optional(),
  version: z.number().int(),
});
export type ResolveCashierShiftDiscrepancyRequest = z.infer<typeof resolveCashierShiftDiscrepancyRequestSchema>;

/**
 * `POST /cashier-shifts/:id/edit` — quyền `cashier_shift.manage`, CHỈ áp dụng cho ca đã
 * CLOSED/APPROVED. `reason` bắt buộc (audit before/after). Chỉ field có mặt mới bị ghi đè.
 * `resyncSystemTotals=true` → server tính lại `cashInAmount`/`cashOutAmount`/`nonCashBreakdown`/
 * `expectedCashAmount` từ `payment` hiện tại (KHÔNG cho nhập tay các cột này).
 */
export const editCashierShiftRequestSchema = z.object({
  reason: z.string().min(1, 'Phải nhập lý do sửa.'),
  version: z.number().int(),
  countedCashAmount: z.number().int().nonnegative().optional(),
  keepForNextAmount: z.number().int().nonnegative().optional(),
  cashDiscrepancyReason: z.string().optional(),
  handoverNote: z.string().optional(),
  resyncSystemTotals: z.boolean().optional(),
});
export type EditCashierShiftRequest = z.infer<typeof editCashierShiftRequestSchema>;
