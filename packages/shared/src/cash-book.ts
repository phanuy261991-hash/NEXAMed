import { z } from 'zod';
import { referenceCatalogDirectionSchema } from './reference-catalog';
import { paymentMethodSchema } from './billing';

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
  type: cashAccountTypeSchema,
  bankName: z.string().nullable(),
  bankAccountNo: z.string().nullable(),
  openingBalance: z.number().int(),
  openingBalanceAt: z.string(),
  isDefault: z.boolean(),
  isActive: z.boolean(),
  version: z.number().int(),
});
export type CashAccount = z.infer<typeof cashAccountSchema>;

export const listCashAccountsResponseSchema = z.object({ items: z.array(cashAccountSchema) });
export type ListCashAccountsResponse = z.infer<typeof listCashAccountsResponseSchema>;

/** `POST /cash-accounts` — `isDefault` bỏ trống mặc định `false`; quỹ `BANK` bắt buộc `bankAccountNo`. */
export const createCashAccountRequestSchema = z
  .object({
    name: z.string().min(1, 'Phải nhập tên quỹ.'),
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
  incomeExpenseTypeCode: z.string(),
  cashAccountId: z.string().uuid(),
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
  version: z.number().int(),
});
export type CashVoucher = z.infer<typeof cashVoucherSchema>;

/**
 * `POST /cash-vouchers` — `status` do server quyết định (POSTED hoặc PENDING_APPROVAL) theo công
 * tắc `cashVoucherApprovalEnabled` của tenant, KHÔNG nhận từ client. `occurredAt` mặc định "bây
 * giờ" nếu bỏ trống — cho phép lùi ngày (ví dụ ghi nhận hoá đơn điện nước tới muộn).
 */
export const createCashVoucherRequestSchema = z.object({
  direction: referenceCatalogDirectionSchema,
  incomeExpenseTypeCode: z.string().min(1, 'Phải chọn loại thu chi.'),
  cashAccountId: z.string().uuid(),
  paymentMethodCode: paymentMethodSchema,
  amount: z.number().int().positive('Số tiền phải lớn hơn 0.'),
  occurredAt: z.string().optional(),
  partnerName: z.string().nullable().optional(),
  description: z.string().min(1, 'Phải nhập diễn giải.'),
  note: z.string().nullable().optional(),
});
export type CreateCashVoucherRequest = z.infer<typeof createCashVoucherRequestSchema>;

/** `PATCH /cash-vouchers/:id` — chỉ sửa được khi `status='POSTED'`/`'PENDING_APPROVAL'` và ca (nếu có) chưa chốt. */
export const updateCashVoucherRequestSchema = z.object({
  incomeExpenseTypeCode: z.string().min(1).optional(),
  cashAccountId: z.string().uuid().optional(),
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
