import { z } from 'zod';
import { referenceCatalogDirectionSchema } from './reference-catalog';
import { paymentMethodSchema } from './billing';
import { allBranchesQuerySchema, reportScopeSchema, withReportScope } from './branch';

/**
 * "Thu chi tại quầy" (Sổ quỹ & Thu chi, Giai đoạn 1) — module `cash-book`. Mockup Artifact duyệt
 * trước khi code (nhóm sidebar mới "Sổ quỹ & Thu chi", 2 nút tắt ở `/billing` và luồng Chốt ca).
 * Phạm vi GĐ1: Quỹ (`cash_account`) + Phiếu thu/Phiếu chi (`cash_voucher`) ngoài dịch vụ khám. Sổ
 * quỹ/Báo cáo dòng tiền là Giai đoạn 2, chưa code — xem plan.
 */

export const cashAccountTypeSchema = z.enum(['CASH', 'BANK', 'DRAWER']);
export type CashAccountType = z.infer<typeof cashAccountTypeSchema>;

export const cashVoucherStatusSchema = z.enum(['POSTED', 'PENDING_APPROVAL', 'REJECTED']);
export type CashVoucherStatus = z.infer<typeof cashVoucherStatusSchema>;

export const cashAccountSchema = z.object({
  id: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  // Đợt 2 chi nhánh (#233, Q1): MỌI quỹ (kể cả quỹ ngân hàng) thuộc đúng một chi nhánh.
  branchId: z.string().uuid(),
  branchName: z.string(),
  type: cashAccountTypeSchema,
  bankName: z.string().nullable(),
  bankAccountNo: z.string().nullable(),
  openingBalance: z.number().int(),
  openingBalanceAt: z.string(),
  isDefault: z.boolean(),
  isActive: z.boolean(),
  /** "Thủ quỹ riêng" (GĐ2) — chỉ có ý nghĩa với `type='DRAWER'`, quỹ thường luôn `null`. */
  ownerUserId: z.string().uuid().nullable(),
  ownerUserName: z.string().nullable(),
  version: z.number().int(),
});
export type CashAccount = z.infer<typeof cashAccountSchema>;

/** Mặc định chỉ quỹ của chi nhánh đang làm; `allBranches=true` = mọi chi nhánh tài khoản được gán (màn quản trị quỹ). */
export const listCashAccountsQuerySchema = z.object({ allBranches: allBranchesQuerySchema });
export type ListCashAccountsQuery = z.infer<typeof listCashAccountsQuerySchema>;

export const listCashAccountsResponseSchema = z.object({ items: z.array(cashAccountSchema) });
export type ListCashAccountsResponse = z.infer<typeof listCashAccountsResponseSchema>;

/** `POST /cash-accounts` — `isDefault` bỏ trống mặc định `false`; quỹ `BANK` bắt buộc `bankAccountNo`. */
export const createCashAccountRequestSchema = z
  .object({
    name: z.string().min(1, 'Phải nhập tên quỹ.'),
    /** Bỏ trống = chi nhánh đang làm việc; phải là chi nhánh tài khoản được gán. Không đổi được sau khi tạo. */
    branchId: z.string().uuid().optional(),
    type: cashAccountTypeSchema,
    bankName: z.string().nullable().optional(),
    bankAccountNo: z.string().nullable().optional(),
    openingBalance: z.number().int().nonnegative().default(0),
    openingBalanceAt: z.string(),
    isDefault: z.boolean().optional(),
  })
  .refine((v) => v.type !== 'BANK' || Boolean(v.bankAccountNo), {
    message: 'Quỹ ngân hàng phải nhập số tài khoản.',
    path: ['bankAccountNo'],
  });
export type CreateCashAccountRequest = z.infer<typeof createCashAccountRequestSchema>;

/** `PATCH /cash-accounts/:id` — không đổi `type` sau khi tạo (đổi loại quỹ giữa chừng vô nghĩa nghiệp vụ). */
export const updateCashAccountRequestSchema = z.object({
  name: z.string().min(1).optional(),
  bankName: z.string().nullable().optional(),
  bankAccountNo: z.string().nullable().optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
  version: z.number().int(),
});
export type UpdateCashAccountRequest = z.infer<typeof updateCashAccountRequestSchema>;

/**
 * Tên hiển thị của `incomeExpenseTypeCode`/`cashAccountId`/`paymentMethodCode` KHÔNG resolve ở
 * đây — web tự map từ danh mục đã tải sẵn cho form Thêm phiếu (`GET /reference-catalog?category=
 * INCOME_EXPENSE_TYPE|PAYMENT_METHOD`, `GET /cash-accounts`), đúng tiền lệ `invoice.paymentMethod`
 * (billing.ts) không resolve tên ở backend. Chỉ `createdByName`/`approvedByName` resolve sẵn (tên
 * NGƯỜI, web không có danh sách toàn bộ tài khoản để tự map — đúng khuôn `CashierShiftDetail`).
 */
export const cashVoucherSchema = z.object({
  id: z.string().uuid(),
  voucherNo: z.string(),
  direction: referenceCatalogDirectionSchema,
  /** `null` cho phiếu Chuyển quỹ (`counterAccountId` có giá trị) — Chuyển quỹ không thuộc "Loại thu chi". */
  incomeExpenseTypeCode: z.string().nullable(),
  cashAccountId: z.string().uuid(),
  /**
   * "Chuyển quỹ" (GĐ2) — có giá trị = phiếu này chuyển tiền từ `cashAccountId` (quỹ nguồn, bị
   * trừ) sang quỹ này (quỹ đích, được cộng). `null` = phiếu Thu/Chi thường.
   */
  counterAccountId: z.string().uuid().nullable(),
  paymentMethodCode: paymentMethodSchema,
  amount: z.number().int(),
  occurredAt: z.string(),
  partnerName: z.string().nullable(),
  description: z.string(),
  note: z.string().nullable(),
  status: cashVoucherStatusSchema,
  /** `true` khi phiếu đã bị huỷ (soft-delete) — KHÔNG có giá trị `status` riêng cho việc này (xem
   * comment model `CashVoucher` ở schema.prisma: cố ý không thêm `VOIDED` vào enum status). Phiếu
   * đã huỷ vẫn hiện trong danh sách/chi tiết (chỉ đọc) để không "biến mất" khó hiểu với lễ tân. */
  voided: z.boolean(),
  approvedByName: z.string().nullable(),
  approvedAt: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  createdByName: z.string(),
  printedAt: z.string().nullable(),
  /** GĐ2 — phiếu Chuyển quỹ tự sinh lúc Chốt ca (Thủ quỹ riêng), khác phiếu lập tay. */
  isAutoGenerated: z.boolean(),
  version: z.number().int(),
});
export type CashVoucher = z.infer<typeof cashVoucherSchema>;

/**
 * `POST /cash-vouchers` — `status` do server quyết định (POSTED hoặc PENDING_APPROVAL) theo công
 * tắc `cashVoucherApprovalEnabled` của tenant, KHÔNG nhận từ client. `occurredAt` mặc định "bây
 * giờ" nếu bỏ trống — cho phép lùi ngày (ví dụ ghi nhận hoá đơn điện nước tới muộn).
 *
 * GĐ2 (Chuyển quỹ) — dùng CHUNG endpoint này: gửi `counterAccountId` thay vì `direction`/
 * `incomeExpenseTypeCode` (server tự ép `direction='EXPENSE'`, không hỏi Thu/Chi — chuyển quỹ chỉ
 * có "từ quỹ nào → quỹ nào"). `.superRefine()` chặn gửi lẫn 2 hình dạng.
 */
export const createCashVoucherRequestSchema = z
  .object({
    direction: referenceCatalogDirectionSchema.optional(),
    incomeExpenseTypeCode: z.string().min(1).optional(),
    cashAccountId: z.string().uuid(),
    counterAccountId: z.string().uuid().optional(),
    paymentMethodCode: paymentMethodSchema,
    amount: z.number().int().positive('Số tiền phải lớn hơn 0.'),
    occurredAt: z.string().optional(),
    partnerName: z.string().nullable().optional(),
    description: z.string().min(1, 'Phải nhập diễn giải.'),
    note: z.string().nullable().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.counterAccountId) {
      if (v.counterAccountId === v.cashAccountId) {
        ctx.addIssue({ code: 'custom', message: 'Quỹ đích phải khác quỹ nguồn.', path: ['counterAccountId'] });
      }
      if (v.direction || v.incomeExpenseTypeCode) {
        ctx.addIssue({ code: 'custom', message: 'Phiếu Chuyển quỹ không có Loại thu chi.', path: ['incomeExpenseTypeCode'] });
      }
      return;
    }
    if (!v.direction) {
      ctx.addIssue({ code: 'custom', message: 'Phải chọn Thu hoặc Chi.', path: ['direction'] });
    }
    if (!v.incomeExpenseTypeCode) {
      ctx.addIssue({ code: 'custom', message: 'Phải chọn loại thu chi.', path: ['incomeExpenseTypeCode'] });
    }
  });
export type CreateCashVoucherRequest = z.infer<typeof createCashVoucherRequestSchema>;

/**
 * `PATCH /cash-vouchers/:id` — chỉ sửa được khi `status='POSTED'`/`'PENDING_APPROVAL'` và ca (nếu
 * có) chưa chốt. `counterAccountId` chỉ có ý nghĩa nếu phiếu ĐÃ là Chuyển quỹ (không đổi hình dạng
 * phiếu Thu/Chi thường ↔ Chuyển quỹ qua sửa — Service chặn).
 */
export const updateCashVoucherRequestSchema = z.object({
  incomeExpenseTypeCode: z.string().min(1).optional(),
  cashAccountId: z.string().uuid().optional(),
  counterAccountId: z.string().uuid().optional(),
  paymentMethodCode: paymentMethodSchema.optional(),
  amount: z.number().int().positive().optional(),
  occurredAt: z.string().optional(),
  partnerName: z.string().nullable().optional(),
  description: z.string().min(1).optional(),
  note: z.string().nullable().optional(),
  version: z.number().int(),
});
export type UpdateCashVoucherRequest = z.infer<typeof updateCashVoucherRequestSchema>;

/** `POST /cash-vouchers/:id/void` — huỷ phiếu (soft-delete), lý do bắt buộc (CLAUDE.md: không xoá cứng). */
export const voidCashVoucherRequestSchema = z.object({
  reason: z.string().min(1, 'Phải nhập lý do huỷ phiếu.'),
  version: z.number().int(),
});
export type VoidCashVoucherRequest = z.infer<typeof voidCashVoucherRequestSchema>;

/** `POST /cash-vouchers/:id/reject` — chỉ áp dụng phiếu `PENDING_APPROVAL`, lý do bắt buộc. */
export const rejectCashVoucherRequestSchema = z.object({
  reason: z.string().min(1, 'Phải nhập lý do từ chối.'),
  version: z.number().int(),
});
export type RejectCashVoucherRequest = z.infer<typeof rejectCashVoucherRequestSchema>;

export const approveCashVoucherRequestSchema = z.object({ version: z.number().int() });
export type ApproveCashVoucherRequest = z.infer<typeof approveCashVoucherRequestSchema>;

export const listCashVouchersQuerySchema = z.object({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  direction: referenceCatalogDirectionSchema.optional(),
  status: cashVoucherStatusSchema.optional(),
  cashierShiftId: z.string().uuid().optional(),
});
export type ListCashVouchersQuery = z.infer<typeof listCashVouchersQuerySchema>;

/** BIL — tổng kết theo bộ lọc đang xem (server tính sẵn, không cộng lại ở web). */
export const listCashVouchersResponseSchema = z.object({
  items: z.array(cashVoucherSchema),
  totalIncomeAmount: z.number().int(),
  totalExpenseAmount: z.number().int(),
  pendingApprovalCount: z.number().int(),
});
export type ListCashVouchersResponse = z.infer<typeof listCashVouchersResponseSchema>;

/**
 * "Sổ quỹ" (GĐ2) — liệt kê MỌI chứng từ ảnh hưởng số dư của 1 quỹ (`payment` của lượt khám +
 * `cash_voucher`), sắp CŨ→MỚI để đọc số dư luỹ kế tự nhiên (khác mọi List Screen khác trong app
 * vốn mới→cũ theo mặc định).
 */
export const cashBookLedgerEntryTypeSchema = z.enum([
  'INVOICE_PAYMENT',
  'INVOICE_REFUND',
  'VOUCHER_INCOME',
  'VOUCHER_EXPENSE',
  'TRANSFER_IN',
  'TRANSFER_OUT',
]);
export type CashBookLedgerEntryType = z.infer<typeof cashBookLedgerEntryTypeSchema>;

export const cashBookLedgerEntrySchema = z.object({
  id: z.string().uuid(),
  occurredAt: z.string(),
  entryType: cashBookLedgerEntryTypeSchema,
  description: z.string(),
  referenceNo: z.string(),
  /** Đã tính dấu — dương = quỹ tăng, âm = quỹ giảm. */
  amountSigned: z.number().int(),
  runningBalance: z.number().int(),
});
export type CashBookLedgerEntry = z.infer<typeof cashBookLedgerEntrySchema>;

export const getCashBookLedgerQuerySchema = z.object({
  cashAccountId: z.string().uuid(),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export type GetCashBookLedgerQuery = z.infer<typeof getCashBookLedgerQuerySchema>;

export const cashBookLedgerResponseSchema = z.object({
  cashAccountId: z.string().uuid(),
  cashAccountName: z.string(),
  /** Chi nhánh của quỹ đang xem (Đợt 3) — quỹ chi nhánh khác chỉ xem được khi có `company_report.read`. */
  branchId: z.string().uuid(),
  branchName: z.string(),
  openingBalance: z.number().int(),
  closingBalance: z.number().int(),
  entries: z.array(cashBookLedgerEntrySchema),
});
export type CashBookLedgerResponse = z.infer<typeof cashBookLedgerResponseSchema>;

/**
 * "Báo cáo dòng tiền" (GĐ2) — `totalIncome`/`totalExpense` TOÀN PHÒNG KHÁM LOẠI TRỪ phiếu Chuyển
 * quỹ (không phải doanh thu/chi phí thật — KHÔNG phải "báo cáo doanh thu theo kỳ" bị loại khỏi
 * phạm vi v1, xem CLAUDE.md). `byAccount[].closingBalance` CÓ tính cả 2 chiều Chuyển quỹ (đúng
 * tồn quỹ thật của riêng quỹ đó).
 */
export const cashFlowReportQuerySchema = withReportScope({
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});
export type CashFlowReportQuery = z.infer<typeof cashFlowReportQuerySchema>;

/**
 * Các quỹ chọn được ở "Sổ quỹ" (Đợt 3 chi nhánh, docs/DECISIONS.md #235): `scope=current` (mặc định) = quỹ của chi nhánh đang làm; `scope=all` = quỹ MỌI
 * chi nhánh (cần quyền `company_report.read`, ô Quỹ nhóm theo chi nhánh, chỉ xem).
 */
export const cashBookLedgerAccountsQuerySchema = z.object({ scope: reportScopeSchema.optional().default('current') });
export type CashBookLedgerAccountsQuery = z.infer<typeof cashBookLedgerAccountsQuerySchema>;

export const cashFlowReportGroupSchema = z.object({
  key: z.string(),
  label: z.string(),
  totalIncome: z.number().int(),
  totalExpense: z.number().int(),
});
export type CashFlowReportGroup = z.infer<typeof cashFlowReportGroupSchema>;

export const cashFlowReportAccountGroupSchema = cashFlowReportGroupSchema.extend({
  closingBalance: z.number().int(),
  /** Chi nhánh của quỹ (Đợt 3) — web chỉ hiện cột khi báo cáo gộp từ 2 chi nhánh trở lên. */
  branchId: z.string().uuid(),
  branchName: z.string(),
});
export type CashFlowReportAccountGroup = z.infer<typeof cashFlowReportAccountGroupSchema>;

/** Tổng thu/chi theo từng chi nhánh trong phạm vi báo cáo (Đợt 3) — cùng quy tắc `byType`: LOẠI TRỪ phiếu Chuyển quỹ, nên tổng các dòng = `totalIncome`/`totalExpense`. */
export const cashFlowReportBranchGroupSchema = z.object({
  branchId: z.string().uuid(),
  branchName: z.string(),
  totalIncome: z.number().int(),
  totalExpense: z.number().int(),
});
export type CashFlowReportBranchGroup = z.infer<typeof cashFlowReportBranchGroupSchema>;

export const cashFlowReportResponseSchema = z.object({
  totalIncome: z.number().int(),
  totalExpense: z.number().int(),
  byType: z.array(cashFlowReportGroupSchema),
  byAccount: z.array(cashFlowReportAccountGroupSchema),
  byBranch: z.array(cashFlowReportBranchGroupSchema),
});
export type CashFlowReportResponse = z.infer<typeof cashFlowReportResponseSchema>;
