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
