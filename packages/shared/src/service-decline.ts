import { z } from 'zod';
import { clinicalOrderItemStatusSchema } from './clinical-order';

/**
 * "Khách không làm dịch vụ" (docs/DECISIONS.md #280) — hợp đồng dùng chung giữa web và máy chủ cho
 * luồng thu ngân bỏ một dịch vụ kỹ thuật mà bác sĩ đã chỉ định.
 *
 * MỘT luồng, HAI nhánh tự chọn theo trạng thái phiếu thu (client KHÔNG chọn nhánh, máy chủ quyết):
 *  - phiếu `UNPAID` → gỡ dòng hoá đơn, trừ `invoice.total_amount`;
 *  - phiếu `PAID`   → hoàn một phần theo khuôn #203 (KHÔNG nhập lại kho vì dịch vụ không có hàng).
 *
 * Cả hai nhánh đều đặt dòng chỉ định sang `CANCELLED` + lý do — KHÔNG soft-delete, vì đây là SỰ KIỆN
 * của người bệnh chứ không phải bác sĩ sửa nhầm (ba khái niệm tách bạch ở #280, đúng tiền lệ
 * "Đánh dấu chưa thu ≠ Huỷ lượt khám ≠ Hoàn tiền" của thu ngân).
 *
 * Web KHÔNG import `@nexamed/core` lúc chạy (#073) nên MỌI số tiền hiện trong hộp thoại do máy chủ
 * tính (endpoint báo giá) — web chỉ hiển thị, không tự cộng trừ.
 */

/**
 * Khi khách bỏ MỘT dịch vụ nằm trong gói dịch vụ (gói có giá riêng hoặc giá tổng trừ chiết khấu).
 * Công tắc cấp phòng khám ở "Cấu hình thanh toán"; mặc định `BLOCK`.
 */
export const PACKAGE_DECLINE_MODES = ['BLOCK', 'REPRICE_SINGLE', 'KEEP_PACKAGE_PRICE'] as const;
export const packageDeclineModeSchema = z.enum(PACKAGE_DECLINE_MODES);
export type PackageDeclineMode = z.infer<typeof packageDeclineModeSchema>;

export const DEFAULT_PACKAGE_DECLINE_MODE: PackageDeclineMode = 'BLOCK';

/** Nhãn tiếng Việt của công tắc — dùng ở trang cấu hình và trong câu giải thích của hộp thoại. */
export const PACKAGE_DECLINE_MODE_LABELS: Record<PackageDeclineMode, string> = {
  BLOCK: 'Không cho bỏ lẻ',
  REPRICE_SINGLE: 'Bỏ lẻ, tính lại theo giá lẻ',
  KEEP_PACKAGE_PRICE: 'Bỏ lẻ, giữ nguyên giá gói',
};

/** Câu mô tả hệ quả của từng chế độ (hiện dưới mỗi thẻ chọn ở trang cấu hình). */
export const PACKAGE_DECLINE_MODE_HINTS: Record<PackageDeclineMode, string> = {
  BLOCK: 'Chỉ bỏ được cả gói.',
  REPRICE_SINGLE: 'Các dịch vụ còn lại tính theo giá lẻ; khách có thể phải trả thêm.',
  KEEP_PACKAGE_PRICE: 'Số tiền không đổi, khách vẫn trả đủ giá gói.',
};

/** Vì sao một dòng KHÔNG bỏ được — mã lý do, nhãn tiếng Việt ở `SERVICE_DECLINE_BLOCKED_LABELS`. */
export const SERVICE_DECLINE_BLOCKED_REASONS = [
  /** Đã lấy mẫu / gọi vào phòng / có kết quả — việc đã làm thì vẫn phải trả tiền. */
  'WORK_STARTED',
  /** Dòng chỉ định đã huỷ trước đó. */
  'ALREADY_CANCELLED',
  /** Phần tiền của dòng đã được hoàn hết. */
  'ALREADY_REFUNDED',
  /** Nằm trong gói dịch vụ mà phòng khám đang chặn bỏ lẻ. */
  'PACKAGE_ITEM_BLOCKED',
  /** Dịch vụ trong gói, chế độ "tính lại theo giá lẻ", nhưng phiếu ĐÃ THU — tính lại có thể đòi thu thêm nên không làm được trên phiếu đã đóng tiền. */
  'PACKAGE_REPRICE_PAID',
  /** Dòng chỉ định ra ngoài: không có dòng hoá đơn nên không có gì để gỡ hay hoàn ở quầy. */
  'NOT_BILLED_HERE',
] as const;
export type ServiceDeclineBlockedReason = (typeof SERVICE_DECLINE_BLOCKED_REASONS)[number];

export const SERVICE_DECLINE_BLOCKED_LABELS: Record<ServiceDeclineBlockedReason, string> = {
  WORK_STARTED: 'Đã lấy mẫu hoặc đã thực hiện',
  ALREADY_CANCELLED: 'Đã huỷ trước đó',
  ALREADY_REFUNDED: 'Đã hoàn tiền',
  PACKAGE_ITEM_BLOCKED: 'Thuộc gói dịch vụ — phòng khám không cho bỏ lẻ',
  PACKAGE_REPRICE_PAID: 'Thuộc gói, phiếu đã thu — chỉ bỏ được khi chưa thu hoặc ở chế độ giữ giá gói',
  NOT_BILLED_HERE: 'Chỉ định ra ngoài, không tính tiền ở đây',
};
export const serviceDeclineBlockedReasonSchema = z.enum(SERVICE_DECLINE_BLOCKED_REASONS);

/** Hành động máy chủ sẽ làm, suy từ trạng thái phiếu thu — web chỉ ĐỌC để hiện câu hệ quả. */
export const serviceDeclineActionSchema = z.enum(['REMOVE_LINE', 'REFUND', 'NO_MONEY_CHANGE']);
export type ServiceDeclineAction = z.infer<typeof serviceDeclineActionSchema>;

/** Ghi thêm của thu ngân: tuỳ chọn, cùng giới hạn với các ô lý do khác trong hệ thống. */
export const SERVICE_DECLINE_NOTE_MAX = 500;

// ── Xem trước (hộp thoại mở ra) ────────────────────────────────────────────────────────────────

export const serviceDeclinePreviewItemSchema = z.object({
  orderItemId: z.string().uuid(),
  name: z.string(),
  quantity: z.number().int(),
  status: clinicalOrderItemStatusSchema,
  /** `null` = dịch vụ lẻ. */
  packageId: z.string().uuid().nullable(),
  packageName: z.string().nullable(),
  /** Tiền thật của dòng (sau chiết khấu) — chỉ có với dịch vụ LẺ; dịch vụ con trong gói không có giá riêng (`null`). */
  amount: z.number().int().nullable(),
  declinable: z.boolean(),
  blockedReason: serviceDeclineBlockedReasonSchema.nullable(),
  blockedLabel: z.string().nullable(),
});
export type ServiceDeclinePreviewItem = z.infer<typeof serviceDeclinePreviewItemSchema>;

export const serviceDeclinePreviewSchema = z.object({
  invoiceId: z.string().uuid(),
  invoiceNo: z.string(),
  invoiceStatus: z.enum(['UNPAID', 'PAID', 'REFUNDED', 'CANCELLED']),
  /** Phiên bản phiếu — gửi lại lúc xác nhận để chống hai thu ngân ghi chồng. */
  invoiceVersion: z.number().int().nonnegative(),
  packageMode: packageDeclineModeSchema,
  /** `null` = phiếu đã đóng sổ (huỷ/hoàn hết), không còn gì để bỏ. */
  action: z.enum(['REMOVE_LINE', 'REFUND']).nullable(),
  items: z.array(serviceDeclinePreviewItemSchema),
});
export type ServiceDeclinePreview = z.infer<typeof serviceDeclinePreviewSchema>;

export const declinePreviewQuerySchema = z.object({ invoiceId: z.string().uuid() });
export type DeclinePreviewQuery = z.infer<typeof declinePreviewQuerySchema>;

// ── Báo giá (số tiền hiện ở chân hộp thoại, tính lại mỗi lần tích) ─────────────────────────────

export const declineQuoteRequestSchema = z.object({
  invoiceId: z.string().uuid(),
  orderItemIds: z.array(z.string().uuid()).min(1, 'Chọn ít nhất một dịch vụ.'),
});
export type DeclineQuoteRequest = z.infer<typeof declineQuoteRequestSchema>;

export const serviceDeclineQuoteSchema = z.object({
  action: serviceDeclineActionSchema,
  /** Số dịch vụ sẽ bỏ. */
  itemCount: z.number().int(),
  /** Tiền GIẢM khỏi phiếu (phiếu chưa thu) hoặc tiền HOÀN lại khách (phiếu đã thu). Luôn ≥ 0. */
  amount: z.number().int(),
  /** Tiền khách phải trả THÊM — chỉ xảy ra khi bỏ dịch vụ trong gói ở chế độ tính lại theo giá lẻ. Luôn ≥ 0. */
  surcharge: z.number().int(),
  /** Tổng phải thu SAU khi bỏ (chỉ có với phiếu chưa thu). */
  newDueAmount: z.number().int().nullable(),
  /** Hoàn về đâu, theo đúng phương thức đã thu (chỉ có với phiếu đã thu): ví trước, phần dư ra tiền mặt/chuyển khoản. */
  refundBreakdown: z.array(z.object({ method: z.string(), amount: z.number().int() })),
});
export type ServiceDeclineQuote = z.infer<typeof serviceDeclineQuoteSchema>;

// ── Xác nhận ───────────────────────────────────────────────────────────────────────────────────

export const declineServicesRequestSchema = z.object({
  invoiceId: z.string().uuid(),
  /** Dòng chỉ định khách không làm — ít nhất một dòng. */
  orderItemIds: z.array(z.string().uuid()).min(1, 'Chọn ít nhất một dịch vụ.'),
  /** Mã danh mục `SERVICE_DECLINE_REASON`. Bắt buộc — lý do được in ra bệnh án. */
  reasonCode: z.string().trim().min(1, 'Chọn lý do khách không làm dịch vụ.'),
  /** Ghi thêm tự do, không bắt buộc. */
  reasonNote: z.string().trim().max(SERVICE_DECLINE_NOTE_MAX).optional(),
  /** Chống ghi chồng khi hai thu ngân mở cùng một phiếu. */
  invoiceVersion: z.number().int().nonnegative(),
});
export type DeclineServicesRequest = z.infer<typeof declineServicesRequestSchema>;
