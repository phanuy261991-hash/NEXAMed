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
 * Kho Thuốc GĐ3 (#163/#165) — `SERVICE` (hoá đơn dịch vụ khám, mặc định, tối đa 1/lượt khám) hay
 * `DRUG` (hoá đơn tiền thuốc, sinh khi hoá đơn SERVICE đã đóng hoặc tenant bật tách riêng — có thể
 * nhiều hoá đơn `DRUG`/lượt khám). Trước #165 field này chưa từng lộ ra ngoài DB.
 */
// `PARACLINICAL` (Cận lâm sàng GĐ3, #212) — hoá đơn tiền chỉ định cận lâm sàng RIÊNG; cũng là nguồn của dòng (`lineSource`).
export const invoiceTypeSchema = z.enum(['SERVICE', 'DRUG', 'PARACLINICAL']);
export type InvoiceType = z.infer<typeof invoiceTypeSchema>;

/**
 * Mã tham chiếu `reference_catalog` category `PAYMENT_METHOD` (text, KHÔNG enum cố định — chủ dự
 * án yêu cầu trực tiếp 2026-08-27, đảo ngược thiết kế ban đầu chỉ có CASH/BANK_TRANSFER). Cùng
 * khuôn `examTypeCode`/`priceTypeCode`/`unitCode` — snapshot mã lúc thu tiền, không FK cứng.
 */
export const paymentMethodSchema = z.string().min(1);
export type PaymentMethod = z.infer<typeof paymentMethodSchema>;

/**
 * Chiết khấu (chốt qua `AskUserQuestion`) — PERCENT: 0-100 (nguyên). AMOUNT: số tiền đồng.
 * `discountAmount`/`dueAmount` là số ĐÃ TÍNH (không lưu cột riêng ở DB — `computeInvoiceDiscount()`
 * ở `@nexamed/core`), trả kèm DTO để web không phải tự tính lại.
 */
export const discountTypeSchema = z.enum(['PERCENT', 'AMOUNT']);
export type DiscountType = z.infer<typeof discountTypeSchema>;

export const invoiceDiscountModeSchema = z.enum(['NONE', 'TOTAL', 'PER_LINE']);
export type InvoiceDiscountMode = z.infer<typeof invoiceDiscountModeSchema>;

export const invoiceLineSchema = z.object({
  id: z.string().uuid(),
  examTypeCode: z.string(),
  examTypeName: z.string(),
  priceTypeCode: z.string().nullable(),
  unitCode: z.string().nullable(),
  unitPrice: z.number().int(),
  quantity: z.number().int(),
  lineTotal: z.number().int(),
  /** Chiết khấu "Từng dịch vụ" — `null` khi dòng này không bị chiết khấu (kể cả khi mode PER_LINE). */
  discountType: discountTypeSchema.nullable(),
  discountValue: z.number().int().nullable(),
  /** Số tiền chiết khấu đã tính của RIÊNG dòng này — 0 khi `discountType` null. */
  discountAmount: z.number().int(),
  /**
   * Kho Thuốc GĐ3 (#163/#165) — nguồn gốc dòng: `SERVICE` (dịch vụ khám) hay `DRUG` (tiền thuốc,
   * từ Phiếu xuất kho). Web nhóm 2 phần "Dịch vụ khám"/"Tiền thuốc" theo field này khi hiển thị.
   */
  lineSource: invoiceTypeSchema,
  /** Mã Phiếu xuất kho nguồn — chỉ có giá trị khi `lineSource==='DRUG'`, dùng làm nhãn nhóm "Tiền
   * thuốc — Phiếu xuất {stockIssueNo}" (không có mã đơn thuốc hiển thị — `prescription` chỉ có `id`). */
  stockIssueNo: z.string().nullable(),
  /** Mã phiếu chỉ định cận lâm sàng nguồn — chỉ có khi `lineSource==='PARACLINICAL'` (nhãn nhóm "Cận lâm sàng — Phiếu CLS..."). */
  clinicalOrderNo: z.string().nullable(),
  /**
   * Hoàn tiền MỘT PHẦN theo dòng thuốc (#203) — số tiền THẬT của dòng sau khi chia chiết khấu (tổng
   * các dòng luôn khớp `dueAmount` từng đồng, `allocateInvoiceDueToLines()` ở `@nexamed/core`), số
   * lượng/tiền đã hoàn của riêng dòng này. Số lượng còn hoàn được = `quantity - refundedQuantity`.
   */
  netAmount: z.number().int(),
  refundedQuantity: z.number().int(),
  refundedAmount: z.number().int(),
});
export type InvoiceLine = z.infer<typeof invoiceLineSchema>;

/** Một dòng của một lần hoàn tiền một phần (#203). */
export const invoiceRefundLineSchema = z.object({
  invoiceLineId: z.string().uuid(),
  itemName: z.string(),
  quantity: z.number().int(),
  amount: z.number().int(),
  /** Đã nhập lại kho (phiếu nhập hoàn trả RETURN_FROM_USE tự sinh). */
  restocked: z.boolean(),
});
export type InvoiceRefundLine = z.infer<typeof invoiceRefundLineSchema>;

/** Một lần hoàn tiền một phần (#203) — hoá đơn có thể có nhiều lần, mới nhất ở cuối. */
export const invoiceRefundSchema = z.object({
  id: z.string().uuid(),
  refundNo: z.string(),
  refundedAt: z.string(),
  reason: z.string(),
  totalAmount: z.number().int(),
  lines: z.array(invoiceRefundLineSchema),
});
export type InvoiceRefund = z.infer<typeof invoiceRefundSchema>;

/**
 * Chi tiết 1 phiếu thu (`GET /billing/invoices/:encounterId`). `null` khi lượt khám đó không có
 * phiếu thu (không có dòng dịch vụ nào có giá lúc tiếp nhận — không có gì để thu, xem
 * `InvoiceService.createFromServiceItems`).
 */
/** Kho Thuốc GĐ3 (#165) — tóm tắt 1 hoá đơn KHÁC của CÙNG lượt khám, cho khối tham chiếu chéo khi
 * 1 lượt khám có >1 hoá đơn (hoá đơn khám đã đóng + hoá đơn thuốc riêng). */
export const invoiceSiblingSchema = z.object({
  invoiceId: z.string().uuid(),
  invoiceNo: z.string(),
  invoiceType: invoiceTypeSchema,
  status: invoiceStatusSchema,
  dueAmount: z.number().int(),
});
export type InvoiceSibling = z.infer<typeof invoiceSiblingSchema>;

export const invoiceSchema = z.object({
  id: z.string().uuid(),
  encounterId: z.string().uuid(),
  invoiceNo: z.string(),
  invoiceType: invoiceTypeSchema,
  status: invoiceStatusSchema,
  /** Tổng tiền dịch vụ TRƯỚC chiết khấu (gross) — giữ nguyên ý nghĩa cũ, KHÔNG phải số tiền phải thu. */
  totalAmount: z.number().int(),
  lines: z.array(invoiceLineSchema),
  /** Chiết khấu cấp HOÁ ĐƠN (mode TOTAL) — `null` khi không dùng cách này (mode NONE/PER_LINE). */
  discountMode: invoiceDiscountModeSchema,
  discountType: discountTypeSchema.nullable(),
  discountValue: z.number().int().nullable(),
  discountReason: z.string().nullable(),
  /** Tổng tiền chiết khấu đã tính — 0 khi `discountMode==='NONE'`. */
  discountAmount: z.number().int(),
  /** `totalAmount - discountAmount` — số tiền THẬT phải thu/đã thu. Mọi nơi tính "Cần thu"/so sánh
   * tiền khách đưa/số dư ví phải dùng field này, KHÔNG dùng `totalAmount`. */
  dueAmount: z.number().int(),
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
  /** Có mặt khi `status='PAID'` — dòng thanh toán ĐẦU TIÊN (đủ cho hiển thị đơn giản khi chỉ có 1
   * dòng — trường hợp phổ biến). Trả hỗn hợp (Ví tạm ứng) có 2 dòng thì dùng `payments[]` bên dưới
   * để hiện đủ, 2 field này giữ nguyên để không phá màn hình đang dùng field đơn hiện có. */
  paymentMethod: paymentMethodSchema.nullable(),
  paidAt: z.string().nullable(),
  /** Mọi dòng thanh toán hiệu lực của phiếu — thường 1 phần tử, 2 phần tử khi trả hỗn hợp (Ví tạm
   * ứng: 1 dòng `WALLET` + 1 dòng tiền mặt/CK cho phần còn lại). Rỗng khi `status!=='PAID'`. */
  payments: z.array(z.object({ method: paymentMethodSchema, amount: z.number().int() })),
  /** #085 — `true` khi lượt khám đã bị huỷ (khách bỏ về). Nguồn cho cảnh báo "Cần hoàn tiền". */
  encounterCancelled: z.boolean(),
  /** #085 — suy ra từ (`status='PAID'` && `encounterCancelled`), xem `needsRefund()` ở `@nexamed/core`. */
  needsRefund: z.boolean(),
  /** #085 — có mặt khi `status='REFUNDED'`: thời điểm + lý do hoàn tiền, in lên phiếu chi. */
  refundedAt: z.string().nullable(),
  refundReason: z.string().nullable(),
  /** Kho Thuốc GĐ3 (#165) — mọi hoá đơn KHÁC của cùng lượt khám (rỗng ở đa số trường hợp — chỉ có
   * khi tenant bật tách hoá đơn thuốc hoặc hoá đơn khám đã đóng lúc phát thuốc, xem #163 điểm 5). */
  otherInvoices: z.array(invoiceSiblingSchema),
  /**
   * Hoàn tiền MỘT PHẦN (#203) — tổng tiền đã hoàn của phiếu (tổng các dòng payment REFUND, cả hoàn
   * một phần lẫn hoàn toàn phần #085), 0 khi chưa hoàn. Phiếu còn `PAID` mà `refundedAmount>0` là
   * đã hoàn một phần; `REFUNDED` là đã hoàn đủ. `refunds` liệt kê từng lần hoàn một phần.
   */
  refundedAmount: z.number().int(),
  refunds: z.array(invoiceRefundSchema),
  version: z.number().int(),
});
export type Invoice = z.infer<typeof invoiceSchema>;

export const invoiceResponseSchema = invoiceSchema.nullable();
export type InvoiceResponse = z.infer<typeof invoiceResponseSchema>;

/**
 * `POST /billing/invoices/:encounterId/print-combined` — Phiếu thu tổng hợp: in gộp MỌI phiếu thu
 * chưa huỷ của cùng 1 lượt khám thành 1 bản in (không sinh bản ghi hoá đơn mới, chỉ là cách trình
 * bày lúc in). Mỗi phần tử `invoices` là 1 phiếu đầy đủ (`invoiceSchema`, SERVICE trước rồi DRUG theo
 * thứ tự tạo; `otherInvoices` luôn rỗng vì đã gộp cả vào mảng này). `totals` tính sẵn server-side
 * (`computeCombinedInvoiceTotals()` ở `@nexamed/core`) để web không cộng lại.
 */
export const combinedInvoiceTotalsSchema = z.object({
  invoiceCount: z.number().int(),
  /** Tổng gross trước chiết khấu. */
  grossAmount: z.number().int(),
  discountAmount: z.number().int(),
  /** Tổng đã thu — gồm cả phiếu sau đó bị hoàn. */
  paidAmount: z.number().int(),
  refundedAmount: z.number().int(),
  /** Còn phải thu — tổng các phiếu `UNPAID`. */
  unpaidAmount: z.number().int(),
});
export type CombinedInvoiceTotals = z.infer<typeof combinedInvoiceTotalsSchema>;

export const combinedInvoicePrintResponseSchema = z.object({
  invoices: z.array(invoiceSchema),
  totals: combinedInvoiceTotalsSchema,
});
export type CombinedInvoicePrintResponse = z.infer<typeof combinedInvoicePrintResponseSchema>;

/**
 * Hoá đơn ĐÍCH của mọi thao tác ghi (thu tiền/lưu tạm/đánh dấu chưa thu/hoàn tiền/chiết khấu/in).
 * Bỏ trống = hoá đơn `SERVICE` của lượt khám (hành vi cũ, mọi nơi gọi trước Kho Thuốc GĐ3 không
 * phải sửa gì). Có giá trị = đúng hoá đơn đó, BẮT BUỘC thuộc `:encounterId` trên URL (không thì
 * 404 — không lộ hoá đơn của lượt khám khác), dùng cho hoá đơn `DRUG` riêng.
 *
 * **Lý do bắt buộc phải có**: trước đây mọi thao tác ghi đều tự lấy hoá đơn `SERVICE` trong khi web
 * gửi lên `version` của hoá đơn ĐANG XEM — trùng version thì ghi nhầm sang hoá đơn khám (thu tiền
 * thuốc lại đánh dấu tiền khám đã thu), lệch version thì báo lỗi khó hiểu; cả hai đều khiến hoá đơn
 * tiền thuốc riêng KHÔNG thu được. Xem `docs/DECISIONS.md` #202.
 */
const targetInvoiceIdSchema = z.string().uuid().optional();

/** `POST /billing/invoices/:encounterId/save-draft` ("Lưu tạm", F8) — không đổi `status`. */
export const saveInvoiceDraftRequestSchema = z.object({
  invoiceId: targetInvoiceIdSchema,
  pendingPaymentMethod: paymentMethodSchema.nullable(),
  pendingCashReceivedAmount: z.number().int().nonnegative().nullable(),
  version: z.number().int(),
});
export type SaveInvoiceDraftRequest = z.infer<typeof saveInvoiceDraftRequestSchema>;

/** `POST /billing/invoices/:encounterId/pay` — đánh dấu "Đã thu" (BIL-03). */
export const markInvoicePaidRequestSchema = z.object({
  invoiceId: targetInvoiceIdSchema,
  method: paymentMethodSchema,
  version: z.number().int(),
});
export type MarkInvoicePaidRequest = z.infer<typeof markInvoicePaidRequestSchema>;

/** `POST /billing/invoices/:encounterId/print` — ghi nhận `printedAt`. Body tuỳ chọn (chỉ `invoiceId`). */
export const printInvoiceRequestSchema = z.object({
  invoiceId: targetInvoiceIdSchema,
});
export type PrintInvoiceRequest = z.infer<typeof printInvoiceRequestSchema>;

/** `POST /billing/invoices/:encounterId/revert-payment` — "Đánh dấu chưa thu" (huỷ nhầm), lý do bắt buộc. */
export const revertInvoicePaymentRequestSchema = z.object({
  invoiceId: targetInvoiceIdSchema,
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
  invoiceId: targetInvoiceIdSchema,
  reason: z.string().min(1, 'Phải nhập lý do hoàn tiền.'),
  version: z.number().int(),
});
export type RefundInvoiceRequest = z.infer<typeof refundInvoiceRequestSchema>;

/**
 * `POST /billing/invoices/:encounterId/refund-items` — hoàn tiền MỘT PHẦN theo từng dòng thuốc (#203),
 * lượt khám vẫn bình thường. Quyền riêng `invoice.refund_drug`. KHÁC `refund` ở trên (hoàn TOÀN PHẦN
 * cho lượt khám đã huỷ): số tiền hoàn KHÔNG nhận từ client — server tự tính từ `quantity` × phần
 * tiền thật của dòng (đã chia chiết khấu), và tự chọn phương thức hoàn (ví trước). `restock` = thuốc
 * còn dùng được, tự nhập lại kho bằng phiếu RETURN_FROM_USE. `invoiceId` BẮT BUỘC ở đây (khác các
 * thao tác khác): hoàn từng dòng luôn nhắm một hoá đơn cụ thể, không có "mặc định".
 */
export const refundInvoiceItemsRequestSchema = z.object({
  invoiceId: z.string().uuid(),
  reason: z.string().trim().min(1, 'Phải nhập lý do hoàn tiền.'),
  version: z.number().int(),
  lines: z
    .array(
      z.object({
        invoiceLineId: z.string().uuid(),
        quantity: z.number().int().positive('Số lượng hoàn phải lớn hơn 0.'),
        restock: z.boolean(),
      }),
    )
    .min(1, 'Chọn ít nhất một dòng thuốc để hoàn.')
    .refine((lines) => new Set(lines.map((l) => l.invoiceLineId)).size === lines.length, 'Mỗi dòng thuốc chỉ được chọn một lần.'),
});
export type RefundInvoiceItemsRequest = z.infer<typeof refundInvoiceItemsRequestSchema>;

/**
 * `POST /billing/invoices/:encounterId/pay-with-wallet` — Ví tạm ứng. Trừ số dư ví hiện có; nếu
 * không đủ VÀ tenant đã bật "Cho phép thanh toán hỗn hợp" (`wallet_mixed_payment_enabled`) thì bắt
 * buộc kèm `remainderPaymentMethodCode` cho phần còn lại (server tự tính số tiền còn lại, không
 * nhận từ client — tránh sai lệch số tiền thật cần thu). Không đủ mà tenant CHƯA bật → 409
 * `WALLET_INSUFFICIENT_BALANCE` (kèm `details.shortfall`), dùng `topup-and-pay-with-wallet` bên dưới.
 */
export const payInvoiceWithWalletRequestSchema = z.object({
  invoiceId: targetInvoiceIdSchema,
  remainderPaymentMethodCode: paymentMethodSchema.optional(),
  version: z.number().int(),
});
export type PayInvoiceWithWalletRequest = z.infer<typeof payInvoiceWithWalletRequestSchema>;

/**
 * `POST /billing/invoices/:encounterId/topup-and-pay-with-wallet` — nạp thêm vào ví TRƯỚC rồi chạy
 * lại đúng logic `pay-with-wallet` trong CÙNG transaction (Luồng 2 PRD: "Nạp phần thiếu"/"Nạp mức
 * chuẩn"). Quyền riêng `patient_wallet.topup` (có hành động nạp tiền thật, khác `pay-with-wallet`
 * chỉ trừ ví có sẵn).
 */
export const topUpAndPayInvoiceWithWalletRequestSchema = z.object({
  invoiceId: targetInvoiceIdSchema,
  topUpAmount: z.number().int().positive('Số tiền nạp phải lớn hơn 0.'),
  topUpPaymentMethodCode: paymentMethodSchema,
  cashAccountId: z.string().uuid().optional(),
  remainderPaymentMethodCode: paymentMethodSchema.optional(),
  version: z.number().int(),
});
export type TopUpAndPayInvoiceWithWalletRequest = z.infer<typeof topUpAndPayInvoiceWithWalletRequestSchema>;

/**
 * `POST /billing/invoices/:encounterId/discount` — áp/sửa/xoá chiết khấu, CHỈ khi phiếu còn
 * `UNPAID` (chốt qua `AskUserQuestion`: đã "Thu tiền" thì phải "Đánh dấu chưa thu" trước). Union
 * theo `mode` để trạng thái sai (vừa TOTAL vừa PER_LINE, hoặc thiếu field bắt buộc của đúng nhánh)
 * không thể biểu diễn được — không cần validate chéo thủ công ở service. `reason` bắt buộc ở CẢ 3
 * nhánh (kể cả `NONE` — xoá chiết khấu cũng là thao tác đụng tiền cần ghi vết `audit_log`).
 */
const applyInvoiceDiscountNoneSchema = z.object({
  mode: z.literal('NONE'),
  invoiceId: targetInvoiceIdSchema,
  reason: z.string().min(1, 'Phải nhập lý do.'),
  version: z.number().int(),
});

const applyInvoiceDiscountTotalSchema = z.object({
  mode: z.literal('TOTAL'),
  invoiceId: targetInvoiceIdSchema,
  discountType: discountTypeSchema,
  discountValue: z.number().int().positive('Chiết khấu phải lớn hơn 0.'),
  reason: z.string().min(1, 'Phải nhập lý do chiết khấu.'),
  version: z.number().int(),
});

const applyInvoiceDiscountPerLineSchema = z.object({
  mode: z.literal('PER_LINE'),
  invoiceId: targetInvoiceIdSchema,
  /** `discountType: null` = dòng đó KHÔNG chiết khấu (cho phép chiết khấu một phần dịch vụ). */
  lines: z
    .array(
      z.object({
        lineId: z.string().uuid(),
        discountType: discountTypeSchema.nullable(),
        discountValue: z.number().int().positive().nullable(),
      }),
    )
    .min(1),
  reason: z.string().min(1, 'Phải nhập lý do chiết khấu.'),
  version: z.number().int(),
});

// `z.discriminatedUnion` chỉ nhận ZodObject thuần cho từng nhánh (không nhận `.refine()` lồng bên
// trong — sẽ mất khả năng đọc `.shape` để tra discriminant) nên ràng buộc "% không vượt 100" đặt ở
// `.superRefine()` NGOÀI union, áp cho cả 2 chỗ có thể chứa PERCENT (TOTAL và từng dòng PER_LINE).
export const applyInvoiceDiscountRequestSchema = z
  .discriminatedUnion('mode', [applyInvoiceDiscountNoneSchema, applyInvoiceDiscountTotalSchema, applyInvoiceDiscountPerLineSchema])
  .superRefine((v, ctx) => {
    if (v.mode === 'TOTAL' && v.discountType === 'PERCENT' && v.discountValue > 100) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Chiết khấu theo % không vượt quá 100.', path: ['discountValue'] });
    }
    if (v.mode === 'PER_LINE') {
      v.lines.forEach((line, i) => {
        if (line.discountType === 'PERCENT' && line.discountValue !== null && line.discountValue > 100) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Chiết khấu theo % không vượt quá 100.', path: ['lines', i, 'discountValue'] });
        }
      });
    }
  });
export type ApplyInvoiceDiscountRequest = z.infer<typeof applyInvoiceDiscountRequestSchema>;

/**
 * `date` tuỳ chọn (`YYYY-MM-DD`, giờ Việt Nam) — bỏ trống thì server mặc định "hôm nay", cùng quy
 * ước `receptionListQuerySchema`. Lọc theo `encounter.checkedInAt` (đúng ngày tiếp nhận, không
 * phải ngày thu tiền — v1 không tách 2 khái niệm này, đa số phiếu thu ngay trong ngày).
 */
/** `GET /billing/invoices/:encounterId?invoiceId=` (Kho Thuốc GĐ3, #165) — `invoiceId` tuỳ chọn để
 * mở ĐÚNG 1 hoá đơn cụ thể của lượt khám (khác hoá đơn SERVICE mặc định), ví dụ hoá đơn thuốc riêng
 * bấm từ "Danh sách Thu ngân" hoặc nút "Xem hoá đơn" sau khi phát thuốc. */
export const getBillingInvoiceQuerySchema = z.object({
  invoiceId: z.string().uuid().optional(),
});
export type GetBillingInvoiceQuery = z.infer<typeof getBillingInvoiceQuerySchema>;

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
  /** Kho Thuốc GĐ3 (#165) — phân biệt hoá đơn khám/hoá đơn thuốc riêng ngay ở danh sách, để bấm
   * đúng dòng mở đúng hoá đơn (`InvoiceListPage.tsx` truyền kèm `invoiceId` lúc điều hướng). */
  invoiceType: invoiceTypeSchema,
  encounterId: z.string().uuid(),
  encounterNo: z.string(),
  checkedInAt: z.string(),
  patientId: z.string().uuid(),
  patientCode: z.string(),
  fullName: z.string(),
  departmentId: z.string().uuid(),
  departmentName: z.string(),
  /** Tổng tiền dịch vụ TRƯỚC chiết khấu (gross) — xem `dueAmount` bên dưới cho số tiền thật. */
  totalAmount: z.number().int(),
  discountAmount: z.number().int(),
  /** `totalAmount - discountAmount` — số tiền THẬT đã/sẽ thu, dùng cho cột "Tổng tiền" hiển thị và
   * tổng kết cuối ngày (`paidTotalAmount`/`unpaidTotalAmount`/`netTotalAmount` bên dưới). */
  dueAmount: z.number().int(),
  status: invoiceStatusSchema,
  paymentMethod: paymentMethodSchema.nullable(),
  paidAt: z.string().nullable(),
  /** #085 — nguồn cho badge "Cần hoàn tiền" ở danh sách Thu ngân (xem `needsRefund()` ở `@nexamed/core`). */
  needsRefund: z.boolean(),
  /** #203 — tổng đã hoàn (tổng dòng payment REFUND); 0 khi chưa hoàn. Cột "Đã hoàn" đọc field này. */
  refundedAmount: z.number().int(),
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
