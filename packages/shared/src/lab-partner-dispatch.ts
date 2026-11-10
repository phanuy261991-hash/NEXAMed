import { z } from 'zod';

/**
 * "Gửi mẫu đối tác" — hàng đợi gửi mẫu xét nghiệm cho đối tác (docs/DECISIONS.md #291, mockup đã duyệt 06/11/2026).
 * Luồng: dịch vụ xét nghiệm cấu hình "Gửi đối tác" → mẫu đã lấy vào "Chờ gửi" → chọn đối tác, hệ thống áp ĐÚNG giá trả của cặp (dịch vụ × đối tác) và chụp lại → "Đã gửi, chờ kết quả".
 * Giá trả là giá vốn, khách không được thấy: các trường `amount`/`unitCost` chỉ có số khi người xem được phép (`technical_service.update` hoặc `supplier_debt.read`), còn lại là `null`.
 */

export const labPartnerOptionSchema = z.object({
  supplierId: z.string().uuid(),
  supplierCode: z.string(),
  supplierName: z.string(),
  /** Đối tác mặc định của dịch vụ. */
  isDefault: z.boolean(),
  /** Giá trả của cặp (dịch vụ × đối tác); `null` khi người xem không có quyền thấy giá vốn. */
  amount: z.number().int().nonnegative().nullable(),
});
export type LabPartnerOption = z.infer<typeof labPartnerOptionSchema>;

export const labPartnerQueueCountsSchema = z.object({
  pending: z.number().int().nonnegative(),
  sent: z.number().int().nonnegative(),
  done: z.number().int().nonnegative(),
  /** Trong "Đã có kết quả": số mẫu đã nhận PDF nhưng bác sĩ CHƯA duyệt — hiện làm chấm số ở menu cho người có quyền duyệt. */
  awaitingApproval: z.number().int().nonnegative(),
});
export type LabPartnerQueueCounts = z.infer<typeof labPartnerQueueCountsSchema>;

export const listLabPartnerQueueQuerySchema = z.object({
  /** Lọc theo đối tác (tab "Đã gửi"). */
  supplierId: z.string().uuid().optional(),
  /** Tìm theo tên/mã bệnh nhân, mã ống, mã phiếu chỉ định, tên dịch vụ. */
  q: z.string().trim().min(1).max(100).optional(),
});
export type ListLabPartnerQueueQuery = z.infer<typeof listLabPartnerQueueQuerySchema>;

/** Dòng "Chờ gửi": mẫu đã lấy của dịch vụ "Gửi đối tác", chưa có đợt gửi đang hiệu lực. */
export const labPartnerPendingRowSchema = z.object({
  itemId: z.string().uuid(),
  orderNo: z.string(),
  patientId: z.string().uuid(),
  patientName: z.string(),
  patientCode: z.string(),
  serviceCode: z.string(),
  serviceName: z.string(),
  specimenName: z.string().nullable(),
  /** Mã ống mẫu (SID) in trên tem. */
  tubeSid: z.string().nullable(),
  collectedAt: z.string().nullable(),
  collectedByName: z.string().nullable(),
  /** Đối tác đã cấu hình giá cho dịch vụ (đối tác mặc định xếp đầu). Rỗng = dịch vụ chưa có đối tác nào. */
  options: z.array(labPartnerOptionSchema),
});
export type LabPartnerPendingRow = z.infer<typeof labPartnerPendingRowSchema>;

export const listLabPartnerPendingResponseSchema = z.object({
  items: z.array(labPartnerPendingRowSchema),
  counts: labPartnerQueueCountsSchema,
  /** Người xem có được thấy giá trả (giá vốn) hay không — web ẩn cột giá khi `false`. */
  costVisible: z.boolean(),
});
export type ListLabPartnerPendingResponse = z.infer<typeof listLabPartnerPendingResponseSchema>;

/** Dòng "Đã gửi, chờ kết quả". */
export const labPartnerSentRowSchema = z.object({
  itemId: z.string().uuid(),
  dispatchId: z.string().uuid(),
  dispatchNo: z.string(),
  supplierId: z.string().uuid(),
  supplierName: z.string(),
  orderNo: z.string(),
  patientId: z.string().uuid(),
  patientName: z.string(),
  patientCode: z.string(),
  serviceName: z.string(),
  tubeSid: z.string().nullable(),
  sentAt: z.string(),
  sentByName: z.string().nullable(),
  /** Hạn trả kết quả = giờ gửi + "Thời gian trả kết quả" của dịch vụ; `null` khi dịch vụ chưa đặt. */
  dueAt: z.string().nullable(),
  overdue: z.boolean(),
  /** Giá trả đã chụp lúc gửi; `null` khi người xem không có quyền thấy giá vốn. */
  unitCost: z.number().int().nonnegative().nullable(),
});
export type LabPartnerSentRow = z.infer<typeof labPartnerSentRowSchema>;

export const listLabPartnerSentResponseSchema = z.object({
  items: z.array(labPartnerSentRowSchema),
  counts: labPartnerQueueCountsSchema,
  costVisible: z.boolean(),
});
export type ListLabPartnerSentResponse = z.infer<typeof listLabPartnerSentResponseSchema>;

/** Gửi mẫu đi: MỘT đối tác nhận nhiều mẫu (một đợt). Muốn gửi cho nhiều đối tác thì gọi nhiều lần. */
export const sendLabPartnerSamplesRequestSchema = z.object({
  supplierId: z.string().uuid(),
  itemIds: z.array(z.string().uuid()).min(1).max(100),
  /** Giờ gửi thực tế (ghi bù được); bỏ trống = bây giờ. Không được ở tương lai và không trước giờ lấy mẫu. */
  sentAt: z.string().datetime().optional(),
  note: z.string().trim().max(1000).optional(),
});
export type SendLabPartnerSamplesRequest = z.infer<typeof sendLabPartnerSamplesRequestSchema>;

export const sendLabPartnerSamplesResponseSchema = z.object({
  dispatchId: z.string().uuid(),
  dispatchNo: z.string(),
  supplierId: z.string().uuid(),
  supplierName: z.string(),
  sentAt: z.string(),
  items: z.array(
    z.object({
      itemId: z.string().uuid(),
      /** Giá trả đã chụp; `null` khi người gửi không có quyền thấy giá vốn (giá vẫn được áp và lưu). */
      unitCost: z.number().int().nonnegative().nullable(),
      dueAt: z.string().nullable(),
    }),
  ),
});
export type SendLabPartnerSamplesResponse = z.infer<typeof sendLabPartnerSamplesResponseSchema>;

// ---- Nhận kết quả PDF từ đối tác, đối tác không nhận, bác sĩ duyệt (docs/DECISIONS.md #291 bổ sung 5) ----

/** Tệp kết quả của đối tác: PDF, tối đa 10 MB; một tệp gắn được cho NHIỀU dịch vụ của cùng đối tác trong một lần nhận. */
export const LAB_PARTNER_RESULT_MAX_BYTES = 10 * 1024 * 1024;

/** Nội dung kèm theo tệp (multipart: trường `file` là PDF, trường `data` là JSON của schema này). */
export const receiveLabPartnerResultRequestSchema = z.object({
  /** Các dòng gửi mẫu (`itemId` của hàng đợi "Đã gửi") mà tệp này là kết quả; phải cùng một đối tác. */
  itemIds: z.array(z.string().uuid()).min(1).max(100),
  /** Giờ nhận thực tế (ghi bù được); bỏ trống = bây giờ. Không ở tương lai, không trước giờ gửi. */
  receivedAt: z.string().datetime().optional(),
  note: z.string().trim().max(1000).optional(),
});
export type ReceiveLabPartnerResultRequest = z.infer<typeof receiveLabPartnerResultRequestSchema>;

export const receiveLabPartnerResultResponseSchema = z.object({
  receivedCount: z.number().int().positive(),
  supplierName: z.string(),
  fileName: z.string(),
  receivedAt: z.string(),
});
export type ReceiveLabPartnerResultResponse = z.infer<typeof receiveLabPartnerResultResponseSchema>;

/** Đối tác không nhận mẫu: mẫu về "Chờ gửi" để chọn đối tác khác, lần gửi này giữ làm lịch sử và không tính tiền. */
export const rejectLabPartnerItemRequestSchema = z.object({ reason: z.string().trim().min(2).max(500) });
export type RejectLabPartnerItemRequest = z.infer<typeof rejectLabPartnerItemRequestSchema>;

/** Bác sĩ duyệt kết quả đối tác (ký); nhận xét/kết luận là tuỳ chọn. */
export const approveLabPartnerResultRequestSchema = z.object({ conclusionText: z.string().trim().max(2000).optional() });
export type ApproveLabPartnerResultRequest = z.infer<typeof approveLabPartnerResultRequestSchema>;

/** Trả lại kỹ thuật viên (sai tệp, thiếu trang): bỏ kết quả đã nhận, mẫu về "Đã gửi chờ kết quả", đảo bút toán công nợ. Chỉ khi chưa duyệt. */
export const returnLabPartnerResultRequestSchema = z.object({ reason: z.string().trim().min(2).max(500) });
export type ReturnLabPartnerResultRequest = z.infer<typeof returnLabPartnerResultRequestSchema>;

export const labPartnerApprovalSchema = z.enum(['PENDING', 'APPROVED']);
export type LabPartnerApproval = z.infer<typeof labPartnerApprovalSchema>;

/** Dòng "Đã có kết quả": mẫu đã nhận kết quả PDF; `approval` cho biết bác sĩ đã duyệt chưa. */
export const labPartnerDoneRowSchema = z.object({
  itemId: z.string().uuid(),
  dispatchId: z.string().uuid(),
  dispatchNo: z.string(),
  supplierId: z.string().uuid(),
  supplierName: z.string(),
  orderNo: z.string(),
  patientId: z.string().uuid(),
  patientName: z.string(),
  patientCode: z.string(),
  serviceName: z.string(),
  tubeSid: z.string().nullable(),
  sentAt: z.string(),
  receivedAt: z.string(),
  receivedByName: z.string().nullable(),
  /** Hạn trả (giờ gửi + thời gian trả của dịch vụ); `null` khi dịch vụ chưa đặt. */
  dueAt: z.string().nullable(),
  /** Nhận sau hạn trả. */
  late: z.boolean(),
  /** Giá trả đã chụp lúc gửi (= số đã ghi nợ); `null` khi người xem không có quyền thấy giá vốn. */
  unitCost: z.number().int().nonnegative().nullable(),
  approval: labPartnerApprovalSchema,
  approvedAt: z.string().nullable(),
  approvedByName: z.string().nullable(),
  conclusionText: z.string().nullable(),
  fileName: z.string(),
  /** Đường dẫn ký có hạn tới tệp PDF (60 phút). */
  fileUrl: z.string(),
});
export type LabPartnerDoneRow = z.infer<typeof labPartnerDoneRowSchema>;

export const listLabPartnerDoneResponseSchema = z.object({
  items: z.array(labPartnerDoneRowSchema),
  counts: labPartnerQueueCountsSchema,
  costVisible: z.boolean(),
});
export type ListLabPartnerDoneResponse = z.infer<typeof listLabPartnerDoneResponseSchema>;

/**
 * Kết quả đối tác CHỜ BÁC SĨ DUYỆT (docs/DECISIONS.md #291 bổ sung 6): dùng cho khối trong màn khám (`encounterId`) và Tổng quan bác sĩ (`mine`: chỉ lượt khám của chính bác sĩ gọi).
 * Không có bộ lọc = mọi kết quả chờ duyệt của chi nhánh đang làm việc.
 */
export const listLabPartnerAwaitingQuerySchema = z.object({
  encounterId: z.string().uuid().optional(),
  mine: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type ListLabPartnerAwaitingQuery = z.infer<typeof listLabPartnerAwaitingQuerySchema>;

export const listLabPartnerAwaitingResponseSchema = z.object({
  items: z.array(labPartnerDoneRowSchema),
  costVisible: z.boolean(),
});
export type ListLabPartnerAwaitingResponse = z.infer<typeof listLabPartnerAwaitingResponseSchema>;
