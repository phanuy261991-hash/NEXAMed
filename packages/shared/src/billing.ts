import { z } from 'zod';

/**
 * Thu ngân cơ bản (Sprint 5/6, BIL-01→04, docs/DECISIONS.md #072/#080) — module `billing`. Phạm vi
 * "mức 1" (đúng CLAUDE.md): 1 phiếu thu/lượt khám tính từ `encounter_service_item` đã chỉ định sẵn
 * (không nhập lại giá), in phiếu, đánh dấu đã thu/chưa thu + phương thức, tổng kết cuối ngày.
 * KHÔNG có bảng giá đa đối tượng/công nợ/trả góp/BHYT/báo cáo doanh thu theo kỳ.
 */

/** Prefix mã hiển thị `invoice_no` (Phiếu Thu) — cùng khuôn `patient_code`/`encounter_no`. */
export const INVOICE_NO_PREFIX = 'PT';

/**
 * 4 trạng thái từ #085 (huỷ lượt khám + hoàn tiền) — quy tắc chuyển ở
 * `@nexamed/core` `billing/invoice-lifecycle.ts` (nguồn sự thật duy nhất):
 *
 *   UNPAID ──thu tiền──> PAID ──hoàn tiền──> REFUNDED
 *      └──huỷ lượt khám──> CANCELLED
 */
export const invoiceStatusSchema = z.enum(['UNPAID', 'PAID', 'CANCELLED', 'REFUNDED']);
export type InvoiceStatus = z.infer<typeof invoiceStatusSchema>;

/**
 * Mã tham chiếu `reference_catalog` category `PAYMENT_METHOD` (text, KHÔNG enum cố định — chủ dự
 * án yêu cầu trực tiếp 2026-08-27, đảo ngược thiết kế ban đầu chỉ có CASH/BANK_TRANSFER). Cùng
 * khuôn `examTypeCode`/`priceTypeCode`/`unitCode` — snapshot mã lúc thu tiền, không FK cứng.
 */
export const paymentMethodSchema = z.string().min(1);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

export const invoiceLineSchema = z.object({
  id: z.string().uuid(),
  examTypeCode: z.string(),
  examTypeName: z.string(),
  priceTypeCode: z.string().nullable(),
  unitCode: z.string().nullable(),
  unitPrice: z.number().int(),
  quantity: z.number().int(),
  lineTotal: z.number().int(),
});
export type InvoiceLine = z.infer<typeof invoiceLineSchema>;

/**
 * Chi tiết 1 phiếu thu (`GET /billing/invoices/:encounterId`). `null` khi lượt khám đó không có
 * phiếu thu (không có dòng dịch vụ nào có giá lúc tiếp nhận — không có gì để thu, xem
 * `InvoiceService.createFromServiceItems`).
 */
export const invoiceSchema = z.object({
  id: z.string().uuid(),
  encounterId: z.string().uuid(),
  invoiceNo: z.string(),
  status: invoiceStatusSchema,
  totalAmount: z.number().int(),
  lines: z.array(invoiceLineSchema),
  /** Bối cảnh lượt khám/bệnh nhân — gộp sẵn cho màn "Chi tiết thanh toán" (không phải gọi thêm request). */
  encounterNo: z.string(),
  checkedInAt: z.string(),
  patientId: z.string().uuid(),
  patientCode: z.string(),
  fullName: z.string(),
  departmentName: z.string(),
  /** #085 — version của CHÍNH `encounter` (KHÁC `version` ở cuối object này, là version của
   * `invoice`) — cần riêng cho `POST /encounters/:id/cancel` (optimistic lock độc lập với phiếu
   * thu) khi màn Chi tiết thanh toán cho phép "Khách bỏ về/Huỷ lượt khám" ngay tại đây. */
  encounterVersion: z.number().int(),
  printedAt: z.string().nullable(),
  /** "Lưu tạm" (F8) — lễ tân đang nhập dở phương thức/tiền khách đưa, chưa bấm "Thu tiền". */
  pendingPaymentMethod: paymentMethodSchema.nullable(),
  pendingCashReceivedAmount: z.number().int().nullable(),
  /** Có mặt khi `status='PAID'` — lịch sử thu hiệu lực gần nhất (v1 luôn tối đa 1 dòng). */
  paymentMethod: paymentMethodSchema.nullable(),
  paidAt: z.string().nullable(),
  /** #085 — `true` khi lượt khám đã bị huỷ (khách bỏ về). Nguồn cho cảnh báo "Cần hoàn tiền". */
  encounterCancelled: z.boolean(),
  /** #085 — suy ra từ (`status='PAID'` && `encounterCancelled`), xem `needsRefund()` ở `@nexamed/core`. */
  needsRefund: z.boolean(),
  /** #085 — có mặt khi `status='REFUNDED'`: thời điểm + lý do hoàn tiền, in lên phiếu chi. */
  refundedAt: z.string().nullable(),
  refundReason: z.string().nullable(),
  version: z.number().int(),
});
export type Invoice = z.infer<typeof invoiceSchema>;

export const invoiceResponseSchema = invoiceSchema.nullable();
export type InvoiceResponse = z.infer<typeof invoiceResponseSchema>;

/** `POST /billing/invoices/:encounterId/save-draft` ("Lưu tạm", F8) — không đổi `status`. */
export const saveInvoiceDraftRequestSchema = z.object({
  pendingPaymentMethod: paymentMethodSchema.nullable(),
  pendingCashReceivedAmount: z.number().int().nonnegative().nullable(),
  version: z.number().int(),
});
export type SaveInvoiceDraftRequest = z.infer<typeof saveInvoiceDraftRequestSchema>;

/** `POST /billing/invoices/:encounterId/pay` — đánh dấu "Đã thu" (BIL-03). */
export const markInvoicePaidRequestSchema = z.object({
  method: paymentMethodSchema,
  version: z.number().int(),
});
export type MarkInvoicePaidRequest = z.infer<typeof markInvoicePaidRequestSchema>;

/** `POST /billing/invoices/:encounterId/revert-payment` — "Đánh dấu chưa thu" (huỷ nhầm), lý do bắt buộc. */
export const revertInvoicePaymentRequestSchema = z.object({
  reason: z.string().min(1, 'Phải nhập lý do đánh dấu chưa thu.'),
  version: z.number().int(),
});
export type RevertInvoicePaymentRequest = z.infer<typeof revertInvoicePaymentRequestSchema>;

/**
 * `POST /billing/invoices/:encounterId/refund` — HOÀN TIỀN thật cho lượt khám đã huỷ (#085), quyền
 * riêng `invoice.refund`. **Khác hẳn `revert-payment` ở trên**: `revert-payment` là sửa thao tác
 * BẤM NHẦM (xoá vết như chưa từng thu), còn đây là tiền đã vào két nay trả ra — tạo dòng `payment`
 * type `REFUND` đối ứng, giữ đủ vết 2 chiều để đối soát két cuối ngày.
 *
 * v1 chỉ hoàn TOÀN PHẦN nên KHÔNG có field số tiền — server tự lấy đúng `invoice.totalAmount` đã
 * thu, không cho nhập tay (tránh sai sót/gian lận). Mở hoàn một phần sau này chỉ cần thêm field ở
 * đây, cột `payment.amount` đã lưu số thật sẵn.
 */
export const refundInvoiceRequestSchema = z.object({
  reason: z.string().min(1, 'Phải nhập lý do hoàn tiền.'),
  version: z.number().int(),
});
export type RefundInvoiceRequest = z.infer<typeof refundInvoiceRequestSchema>;

/**
 * `date` tuỳ chọn (`YYYY-MM-DD`, giờ Việt Nam) — bỏ trống thì server mặc định "hôm nay", cùng quy
 * ước `receptionListQuerySchema`. Lọc theo `encounter.checkedInAt` (đúng ngày tiếp nhận, không
 * phải ngày thu tiền — v1 không tách 2 khái niệm này, đa số phiếu thu ngay trong ngày).
 */
export const listBillingInvoicesQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date phải theo định dạng YYYY-MM-DD')
    .optional(),
});
export type ListBillingInvoicesQuery = z.infer<typeof listBillingInvoicesQuerySchema>;

export const billingListItemSchema = z.object({
  invoiceId: z.string().uuid(),
  invoiceNo: z.string(),
  encounterId: z.string().uuid(),
  encounterNo: z.string(),
  checkedInAt: z.string(),
  patientId: z.string().uuid(),
  patientCode: z.string(),
  fullName: z.string(),
  departmentId: z.string().uuid(),
  departmentName: z.string(),
  totalAmount: z.number().int(),
  status: invoiceStatusSchema,
  paymentMethod: paymentMethodSchema.nullable(),
  paidAt: z.string().nullable(),
  /** #085 — nguồn cho badge "Cần hoàn tiền" ở danh sách Thu ngân (xem `needsRefund()` ở `@nexamed/core`). */
  needsRefund: z.boolean(),
});
export type BillingListItem = z.infer<typeof billingListItemSchema>;

/**
 * BIL-04 "Tổng kết thu cuối ngày" — tính sẵn server-side cho đúng ngày đang lọc, không cộng lại ở
 * web (nguồn: `computeDailyBillingTotals()` ở `@nexamed/core`).
 *
 * #085 mở rộng từ 2 nhóm lên 3 nhóm + "thực thu". Quy ước quan trọng: phiếu `REFUNDED` VẪN nằm
 * trong `paidTotalAmount` (tiền đã thật sự vào két trong ngày) rồi trừ ra ở `netTotalAmount` —
 * không im lặng xoá khỏi cột "Đã thu", vì như vậy chủ phòng khám đối soát két sẽ thấy chênh mà
 * không giải thích được. Phiếu `CANCELLED` không tính vào cột tiền nào (chưa đồng nào đổi chủ).
 */
export const listBillingInvoicesResponseSchema = z.object({
  items: z.array(billingListItemSchema),
  paidCount: z.number().int(),
  paidTotalAmount: z.number().int(),
  unpaidCount: z.number().int(),
  unpaidTotalAmount: z.number().int(),
  refundedCount: z.number().int(),
  refundedTotalAmount: z.number().int(),
  /** `paidTotalAmount - refundedTotalAmount` — khớp tiền còn lại trong két cuối ngày. */
  netTotalAmount: z.number().int(),
});
export type ListBillingInvoicesResponse = z.infer<typeof listBillingInvoicesResponseSchema>;
