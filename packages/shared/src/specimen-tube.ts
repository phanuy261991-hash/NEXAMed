import { z } from 'zod';

/**
 * Cận lâm sàng — Lấy mẫu xét nghiệm có ống mẫu, mã ống (SID) và tem mã vạch (docs/DECISIONS.md #220). Một ỐNG chứa nhiều xét nghiệm cùng loại mẫu bệnh phẩm của MỘT phiếu
 * chỉ định; KTV mở hộp thoại "Lấy mẫu" (ống sinh sẵn kèm SID) → in tem (tuỳ chọn) → xác nhận từng ống đã lấy (tích tay hoặc quét tem) → các dòng chỉ định của ống chuyển
 * "Đã lấy mẫu". Mã vạch trên tem mã hoá đúng SID.
 */

/** Màu nắp ống — gán cho loại Mẫu bệnh phẩm ở danh mục. `label` ngắn để hiện trong bảng ống / trên tem. */
export const SPECIMEN_CAP_COLORS = [
  { code: 'RED', name: 'Đỏ', label: 'Nắp đỏ' },
  { code: 'YELLOW', name: 'Vàng (gel)', label: 'Nắp vàng' },
  { code: 'PURPLE', name: 'Tím (EDTA)', label: 'Nắp tím' },
  { code: 'BLUE', name: 'Xanh dương (citrat)', label: 'Nắp xanh dương' },
  { code: 'GREEN', name: 'Xanh lá (heparin)', label: 'Nắp xanh lá' },
  { code: 'GRAY', name: 'Xám (fluorid)', label: 'Nắp xám' },
  { code: 'BLACK', name: 'Đen', label: 'Nắp đen' },
  { code: 'URINE', name: 'Lọ / không nắp', label: 'Lọ không nắp' },
] as const;
export const specimenCapColorSchema = z.enum(['RED', 'YELLOW', 'PURPLE', 'BLUE', 'GREEN', 'GRAY', 'BLACK', 'URINE']);
export type SpecimenCapColor = z.infer<typeof specimenCapColorSchema>;

/** Nhãn ngắn của màu nắp ("Nắp tím"); `null` nếu chưa khai/không hợp lệ. */
export function specimenCapLabel(code: string | null | undefined): string | null {
  return SPECIMEN_CAP_COLORS.find((c) => c.code === code)?.label ?? null;
}

export const specimenTubeStatusSchema = z.enum(['PENDING', 'COLLECTED', 'CANCELLED']);
export type SpecimenTubeStatus = z.infer<typeof specimenTubeStatusSchema>;

export const specimenCollectViaSchema = z.enum(['SCAN', 'MANUAL']);
export type SpecimenCollectVia = z.infer<typeof specimenCollectViaSchema>;

/** Viết tắt nhóm dịch vụ in trên tem — tối đa 4 ký tự (ví dụ "HH", "SH"). */
export const SPECIMEN_GROUP_ABBREVIATION_MAX = 4;

export const specimenTubeItemSchema = z.object({
  itemId: z.string().uuid(),
  name: z.string(),
  /** Có thể "Tách" xét nghiệm này sang ống riêng: ống chưa in tem, chưa lấy và còn > 1 xét nghiệm. */
  canSplit: z.boolean(),
});
export type SpecimenTubeItem = z.infer<typeof specimenTubeItemSchema>;

export const specimenTubeViewSchema = z.object({
  id: z.string().uuid(),
  sid: z.string(),
  status: specimenTubeStatusSchema,
  specimenName: z.string().nullable(),
  capColor: specimenCapColorSchema.nullable(),
  capLabel: z.string().nullable(),
  /** Viết tắt các nhóm xét nghiệm trong ống, nối bằng "/" (ví dụ "HH/SH"); `null` nếu nhóm chưa khai viết tắt. */
  groupAbbreviation: z.string().nullable(),
  printCount: z.number().int().nonnegative(),
  lastPrintedAt: z.string().nullable(),
  collectedAt: z.string().nullable(),
  collectedByName: z.string().nullable(),
  collectedVia: specimenCollectViaSchema.nullable(),
  cancelReason: z.string().nullable(),
  /** Lúc huỷ ống (ống `CANCELLED`) — `null` nếu chưa huỷ. */
  cancelledAt: z.string().nullable(),
  /** SID của ống bị huỷ mà ống này lấy lại thay thế. */
  replacesSid: z.string().nullable(),
  /** SID của ống thay thế (với ống đã huỷ). */
  replacedBySid: z.string().nullable(),
  items: z.array(specimenTubeItemSchema),
  /** Huỷ ống & lấy lại được: ống chưa huỷ và chưa có kết quả nào của các xét nghiệm trong ống. */
  canRecollect: z.boolean(),
  /** Huỷ xác nhận đã lấy mẫu được: ống đã lấy và chưa có kết quả nào. */
  canUncollect: z.boolean(),
});
export type SpecimenTubeView = z.infer<typeof specimenTubeViewSchema>;

/** Trạng thái hộp thoại "Lấy mẫu" của MỘT phiếu chỉ định — mọi thao tác trả lại đúng cấu trúc này để web vẽ lại. */
export const specimenCollectionStateSchema = z.object({
  orderId: z.string().uuid(),
  orderNo: z.string(),
  encounterId: z.string().uuid(),
  encounterNo: z.string().nullable(),
  patientName: z.string(),
  patientCode: z.string(),
  /** Năm sinh in trên tem (`null` nếu không có ngày sinh hợp lệ). */
  patientBirthYear: z.number().int().nullable(),
  patientAgeYears: z.number().int().nullable(),
  patientGender: z.enum(['male', 'female', 'other']).nullable(),
  patientPhone: z.string().nullable(),
  doctorName: z.string().nullable(),
  /** Lúc bác sĩ chỉ định. */
  orderedAt: z.string(),
  /** Mọi xét nghiệm còn hiệu lực của phiếu đã thu tiền. */
  paid: z.boolean(),
  /** Công tắc "Bắt buộc quét đủ ống" — bật thì không tích tay được. */
  scanRequired: z.boolean(),
  tubes: z.array(specimenTubeViewSchema),
});
export type SpecimenCollectionState = z.infer<typeof specimenCollectionStateSchema>;

export const specimenCollectionResponseSchema = z.object({ state: specimenCollectionStateSchema });
export type SpecimenCollectionResponse = z.infer<typeof specimenCollectionResponseSchema>;

export const splitSpecimenTubeRequestSchema = z.object({ itemId: z.string().uuid() });
export type SplitSpecimenTubeRequest = z.infer<typeof splitSpecimenTubeRequestSchema>;

export const printSpecimenTubesRequestSchema = z.object({ tubeIds: z.array(z.string().uuid()).min(1).max(30) });
export type PrintSpecimenTubesRequest = z.infer<typeof printSpecimenTubesRequestSchema>;

export const collectSpecimenTubesRequestSchema = z.object({
  tubes: z
    .array(z.object({ tubeId: z.string().uuid(), via: specimenCollectViaSchema }))
    .min(1)
    .max(30),
});
export type CollectSpecimenTubesRequest = z.infer<typeof collectSpecimenTubesRequestSchema>;

const specimenReasonSchema = z.string().trim().min(2, 'Nhập lý do (ít nhất 2 ký tự).').max(200);

export const recollectSpecimenTubeRequestSchema = z.object({ reason: specimenReasonSchema });
export type RecollectSpecimenTubeRequest = z.infer<typeof recollectSpecimenTubeRequestSchema>;

export const uncollectSpecimenTubesRequestSchema = z.object({
  tubeIds: z.array(z.string().uuid()).min(1).max(30),
  reason: specimenReasonSchema,
});
export type UncollectSpecimenTubesRequest = z.infer<typeof uncollectSpecimenTubesRequestSchema>;

export const lookupSpecimenTubeQuerySchema = z.object({ sid: z.string().trim().min(1).max(60) });
export type LookupSpecimenTubeQuery = z.infer<typeof lookupSpecimenTubeQuerySchema>;

/** Kết quả tra mã ống (ô "Quét mã ống"): web quyết định mở hộp thoại lấy mẫu / màn nhập kết quả / báo lỗi. */
export const lookupSpecimenTubeResponseSchema = z.object({
  tubeId: z.string().uuid(),
  sid: z.string(),
  status: specimenTubeStatusSchema,
  orderId: z.string().uuid(),
  orderNo: z.string(),
  patientName: z.string(),
  patientCode: z.string(),
  /** Tab hàng đợi hiện tại (cùng giá trị `paraclinicalQueueBucketSchema`, khai lại để tránh import vòng) của các xét nghiệm trong ống (`null` nếu ống chưa/không có dòng nào còn hiệu lực). */
  bucket: z.enum(['AWAITING_PAYMENT', 'WAITING', 'IN_PROGRESS', 'PENDING_APPROVAL', 'COMPLETED']).nullable(),
  /** Id dòng chỉ định để mở màn nhập kết quả (ống đã lấy). */
  itemId: z.string().uuid().nullable(),
  /** SID của ống thay thế (khi ống đã huỷ để lấy lại). */
  replacedBySid: z.string().nullable(),
  /** Lượt khám đã huỷ — ống không còn dùng được. */
  encounterCancelled: z.boolean(),
});
export type LookupSpecimenTubeResponse = z.infer<typeof lookupSpecimenTubeResponseSchema>;

/** Ống hiện ở dòng hàng đợi Xét nghiệm. `PLANNED` = ống DỰ KIẾN (chưa mở hộp thoại lấy mẫu nên chưa có SID) gộp theo loại mẫu. */
export const queueTubeSchema = z.object({
  id: z.string().uuid().nullable(),
  sid: z.string().nullable(),
  status: z.enum(['PLANNED', 'PENDING', 'COLLECTED']),
  specimenName: z.string().nullable(),
  capColor: specimenCapColorSchema.nullable(),
  capLabel: z.string().nullable(),
});
export type QueueTube = z.infer<typeof queueTubeSchema>;
