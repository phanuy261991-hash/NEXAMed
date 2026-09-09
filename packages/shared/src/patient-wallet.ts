import { z } from 'zod';
import { paymentMethodSchema } from './billing';

/**
 * "Ví tạm ứng" (Patient Advance-Payment Wallet) — module `patient-wallet`. Bệnh nhân nộp tiền
 * trước, hệ thống tự cấn trừ khi phát sinh phiếu thu (tiếp nhận), giảm bước xếp hàng đóng tiền tại
 * quầy. Một ví/bệnh nhân (không theo đợt điều trị — v1 không có khái niệm này). Nạp/tất toán ví
 * tái dùng `cash_voucher` sẵn có (module `cash-book`) để tự động vào Chốt ca/Sổ quỹ/Báo cáo dòng
 * tiền — bản thân ví CHỈ giữ số dư + lịch sử cấn trừ/hoàn (`wallet_transaction`), không tự có sổ
 * quỹ riêng.
 */

export const walletTransactionTypeSchema = z.enum(['TOPUP', 'DEDUCT', 'REFUND', 'SETTLEMENT']);
export type WalletTransactionType = z.infer<typeof walletTransactionTypeSchema>;

export const patientWalletStatusSchema = z.enum(['ACTIVE', 'CLOSED']);
export type PatientWalletStatus = z.infer<typeof patientWalletStatusSchema>;

/** `GET /wallet?patientId=` — `null` khi bệnh nhân chưa từng có ví (chưa nạp lần nào). */
export const patientWalletSchema = z.object({
  id: z.string().uuid(),
  patientId: z.string().uuid(),
  balance: z.number().int(),
  status: patientWalletStatusSchema,
  /** Tổng đã nạp/đã dùng TỪ TRƯỚC ĐẾN NAY — tính sẵn server-side (SUM theo `type`), không cộng lại ở web. */
  totalToppedUp: z.number().int(),
  totalUsed: z.number().int(),
  /** Số lần nạp (đếm dòng TOPUP)/số lượt khám đã cấn trừ (đếm dòng DEDUCT) — dòng phụ dưới 2 ô tile
   * "Tổng đã nạp"/"Đã sử dụng" đúng mockup Artifact "Ví tạm ứng NEXAMed" màn 1 (`3 lần nạp`/`6 lượt khám`). */
  topUpCount: z.number().int(),
  deductCount: z.number().int(),
  lastTransactionAt: z.string().nullable(),
  closedAt: z.string().nullable(),
  version: z.number().int(),
});
export type PatientWallet = z.infer<typeof patientWalletSchema>;

export const getPatientWalletQuerySchema = z.object({ patientId: z.string().uuid() });
export type GetPatientWalletQuery = z.infer<typeof getPatientWalletQuerySchema>;

/**
 * 1 dòng lịch sử ví — `invoiceNo`/`voucherNo` resolve sẵn (bấm mở đúng phiếu thu/chứng từ quỹ liên
 * quan, đúng mockup màn "Ví tạm ứng"). Đúng 1 trong 2 có giá trị tuỳ `type` (TOPUP/SETTLEMENT →
 * `voucherNo`; DEDUCT/REFUND → `invoiceNo`), không bao giờ cả hai cùng có/cùng thiếu.
 */
export const walletTransactionSchema = z.object({
  id: z.string().uuid(),
  type: walletTransactionTypeSchema,
  amount: z.number().int(),
  balanceAfter: z.number().int(),
  invoiceId: z.string().uuid().nullable(),
  invoiceNo: z.string().nullable(),
  /** Bấm mở đúng phiếu thu liên quan (`/billing/invoices/:encounterId`) — chỉ có khi `invoiceId` có giá trị. */
  encounterId: z.string().uuid().nullable(),
  cashVoucherId: z.string().uuid().nullable(),
  voucherNo: z.string().nullable(),
  note: z.string().nullable(),
  createdByName: z.string(),
  createdAt: z.string(),
});
export type WalletTransaction = z.infer<typeof walletTransactionSchema>;

export const listWalletTransactionsQuerySchema = z.object({
  patientId: z.string().uuid(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListWalletTransactionsQuery = z.infer<typeof listWalletTransactionsQuerySchema>;

export const listWalletTransactionsResponseSchema = z.object({
  items: z.array(walletTransactionSchema),
  nextCursor: z.string().nullable(),
});
export type ListWalletTransactionsResponse = z.infer<typeof listWalletTransactionsResponseSchema>;

/** `POST /wallet/topup` — tạo ví (nếu bệnh nhân chưa từng có) rồi cộng số dư, sinh phiếu thu quỹ. */
export const topUpWalletRequestSchema = z.object({
  patientId: z.string().uuid(),
  amount: z.number().int().positive('Số tiền nạp phải lớn hơn 0.'),
  paymentMethodCode: paymentMethodSchema,
  cashAccountId: z.string().uuid().optional(),
  note: z.string().optional(),
});
export type TopUpWalletRequest = z.infer<typeof topUpWalletRequestSchema>;

/**
 * Trả kèm số phiếu/ngày phát sinh để in ngay ("Lưu và in phiếu") — KHÔNG trả nguyên `CashVoucher`
 * (module `cash-book`, cần resolve tên người lập) vì phiếu in chỉ cần đúng vài trường này, tránh
 * kéo thêm phụ thuộc `IamModule` vào `patient-wallet` chỉ để phục vụ 1 response nhỏ.
 */
export const topUpWalletResponseSchema = z.object({
  wallet: patientWalletSchema,
  voucherNo: z.string(),
  occurredAt: z.string(),
});
export type TopUpWalletResponse = z.infer<typeof topUpWalletResponseSchema>;

/** `POST /wallet/settle` — hoàn số dư còn lại (nếu có) ra ngoài + khoá ví, quyền riêng `patient_wallet.settle`. */
export const settleWalletRequestSchema = z.object({
  patientId: z.string().uuid(),
  paymentMethodCode: paymentMethodSchema.optional(),
  cashAccountId: z.string().uuid().optional(),
});
export type SettleWalletRequest = z.infer<typeof settleWalletRequestSchema>;

export const settleWalletResponseSchema = z.object({
  wallet: patientWalletSchema,
  voucherNo: z.string().nullable(),
});
export type SettleWalletResponse = z.infer<typeof settleWalletResponseSchema>;

/** Trang tổng hợp "Ví tạm ứng" (Sổ quỹ & Thu chi) — 1 dòng/bệnh nhân đang có ví. */
export const walletListItemSchema = z.object({
  walletId: z.string().uuid(),
  patientId: z.string().uuid(),
  patientCode: z.string(),
  fullName: z.string(),
  phone: z.string().nullable(),
  balance: z.number().int(),
  totalToppedUp: z.number().int(),
  totalUsed: z.number().int(),
  lastTransactionAt: z.string().nullable(),
  status: patientWalletStatusSchema,
});
export type WalletListItem = z.infer<typeof walletListItemSchema>;

export const listWalletsQuerySchema = z.object({
  q: z.string().min(1).max(100).optional(),
  status: patientWalletStatusSchema.optional(),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type ListWalletsQuery = z.infer<typeof listWalletsQuerySchema>;

/** KPI tính sẵn server-side theo TOÀN BỘ ví (không phụ thuộc bộ lọc `q`/`status`/phân trang). */
export const listWalletsResponseSchema = z.object({
  items: z.array(walletListItemSchema),
  nextCursor: z.string().nullable(),
  totalHeldBalance: z.number().int(),
  activeWalletCount: z.number().int(),
  toppedUpToday: z.number().int(),
  deductedToday: z.number().int(),
});
export type ListWalletsResponse = z.infer<typeof listWalletsResponseSchema>;
