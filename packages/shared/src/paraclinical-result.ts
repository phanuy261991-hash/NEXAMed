import { z } from 'zod';
import { queueTubeSchema } from './specimen-tube';
import { labIndicatorValueTypeSchema, technicalServiceKindSchema, technicalServiceResultTypeSchema } from './technical-service';

/**
 * Cận lâm sàng GĐ4 đợt 1 — Hàng đợi & nhập/duyệt kết quả (docs/DECISIONS.md #212). Mỗi DỊCH VỤ được chỉ định tại phòng khám có đúng 1 kết quả
 * (`paraclinical_result`); các xét nghiệm CÙNG PHIẾU, CÙNG trạng thái được GỘP thành 1 dòng hàng đợi + 1 màn nhập (kỹ thuật viên không phải ra vào
 * nhiều màn), còn mỗi dịch vụ chẩn đoán hình ảnh / thăm dò chức năng là 1 dòng riêng (mỗi cái có mô tả + kết luận riêng).
 */

/** Cột/tab của hàng đợi — suy ra từ trạng thái dòng chỉ định + đã thu tiền hay chưa. */
export const paraclinicalQueueBucketSchema = z.enum(['AWAITING_PAYMENT', 'WAITING', 'IN_PROGRESS', 'PENDING_APPROVAL', 'COMPLETED']);
export type ParaclinicalQueueBucket = z.infer<typeof paraclinicalQueueBucketSchema>;

/** Cờ so với khoảng tham chiếu — tính ở API (nguồn sự thật dùng cho cả bản in), KHÔNG lưu cột. */
export const paraclinicalValueFlagSchema = z.enum(['LOW', 'HIGH', 'NORMAL', 'ABNORMAL']);
export type ParaclinicalValueFlag = z.infer<typeof paraclinicalValueFlagSchema>;

export const listParaclinicalQueueQuerySchema = z.object({
  /** Ngày chỉ định (giờ Việt Nam, YYYY-MM-DD); bỏ trống = hôm nay. */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  bucket: paraclinicalQueueBucketSchema.optional(),
  /** Lọc theo Khoa/Phòng thực hiện. */
  departmentId: z.string().uuid().optional(),
  /** Tìm theo tên, mã bệnh nhân, mã phiếu (không dấu). */
  q: z.string().trim().max(100).optional(),
});
export type ListParaclinicalQueueQuery = z.infer<typeof listParaclinicalQueueQuerySchema>;

export const paraclinicalQueueRowSchema = z.object({
  /** Id dòng chỉ định đầu tiên của nhóm — dùng làm khoá dòng và làm tham số mở màn nhập kết quả. */
  key: z.string().uuid(),
  itemIds: z.array(z.string().uuid()),
  orderNo: z.string(),
  encounterId: z.string().uuid(),
  patientId: z.string().uuid(),
  patientName: z.string(),
  patientCode: z.string(),
  ageYears: z.number().int().nullable(),
  gender: z.enum(['male', 'female', 'other']).nullable(),
  serviceKind: technicalServiceKindSchema,
  serviceNames: z.array(z.string()),
  /** Tên Mẫu bệnh phẩm / Nhóm dịch vụ của các dịch vụ trong dòng (không trùng) — cột "Mẫu bệnh phẩm" và bộ lọc ở hàng đợi Xét nghiệm. */
  specimenNames: z.array(z.string()),
  categoryNames: z.array(z.string()),
  /** Kết quả của dòng này là BẢN ĐÍNH CHÍNH (đang soạn lại hoặc đã duyệt lại) — hàng đợi hiện chip "Đính chính". */
  isAmendment: z.boolean(),
  departmentId: z.string().uuid().nullable(),
  departmentName: z.string().nullable(),
  bucket: paraclinicalQueueBucketSchema,
  /** Mọi dòng của nhóm đã được thu tiền. */
  paid: z.boolean(),
  /** Id phiếu chỉ định — mở hộp thoại "Lấy mẫu" (xét nghiệm). */
  orderId: z.string().uuid(),
  /** Ống mẫu của dòng (chỉ xét nghiệm): ống đã sinh SID hoặc ống DỰ KIẾN gộp theo loại mẫu (docs/DECISIONS.md #220). Rỗng với CĐHA/thăm dò và dòng lấy mẫu trước khi có tính năng ống. */
  tubes: z.array(queueTubeSchema),
  /** Lúc lấy mẫu / gọi vào (mới nhất của nhóm) và người thực hiện — `null` nếu chưa lấy. */
  collectedAt: z.string().nullable(),
  collectedByName: z.string().nullable(),
  /** Đã có bản NHÁP kết quả (đã lưu nhưng chưa gửi duyệt) — hàng đợi hiện nhãn "Đang nhập". */
  hasDraft: z.boolean(),
  /** Mốc tính "Chờ": lúc chỉ định (đang chờ) hoặc lúc lấy mẫu/gọi vào (đang thực hiện). */
  waitingSince: z.string(),
});
export type ParaclinicalQueueRow = z.infer<typeof paraclinicalQueueRowSchema>;

export const listParaclinicalQueueResponseSchema = z.object({
  items: z.array(paraclinicalQueueRowSchema),
  /** Số dòng theo từng tab của NGÀY đang xem (không phụ thuộc bộ lọc tab). */
  counts: z.record(paraclinicalQueueBucketSchema, z.number().int().nonnegative()),
  /** Công tắc "cho thực hiện trước khi thu tiền" của phòng khám. */
  allowBeforePayment: z.boolean(),
});
export type ListParaclinicalQueueResponse = z.infer<typeof listParaclinicalQueueResponseSchema>;

export const startParaclinicalItemsRequestSchema = z.object({
  /** Các dòng cùng PHIẾU muốn lấy mẫu / gọi vào phòng cùng lúc. */
  itemIds: z.array(z.string().uuid()).min(1).max(50),
});
export type StartParaclinicalItemsRequest = z.infer<typeof startParaclinicalItemsRequestSchema>;

export const startParaclinicalItemsResponseSchema = z.object({
  /** Dòng đầu tiên — web dùng để mở thẳng màn nhập kết quả. */
  itemId: z.string().uuid(),
});
export type StartParaclinicalItemsResponse = z.infer<typeof startParaclinicalItemsResponseSchema>;

// ---------------------------------------------------------------------------------------------
// Màn nhập / duyệt kết quả
// ---------------------------------------------------------------------------------------------

/** Dòng khoảng tham chiếu đã chọn theo giới tính × tuổi (cùng hình dạng `LabReferenceRow` ở packages/core). */
export const paraclinicalReferenceSchema = z.object({
  sex: z.enum(['ANY', 'MALE', 'FEMALE']),
  ageFromYears: z.number().int(),
  ageToYears: z.number().int().nullable(),
  lowValue: z.number().nullable(),
  highValue: z.number().nullable(),
  lowInclusive: z.boolean(),
  highInclusive: z.boolean(),
  normalText: z.string().nullable(),
  displayText: z.string().nullable(),
});
export type ParaclinicalReference = z.infer<typeof paraclinicalReferenceSchema>;

export const paraclinicalResultValueViewSchema = z.object({
  indicatorId: z.string().uuid(),
  code: z.string(),
  name: z.string(),
  abbreviation: z.string().nullable(),
  unit: z.string().nullable(),
  valueType: labIndicatorValueTypeSchema,
  decimals: z.number().int().nullable(),
  choiceOptions: z.array(z.string()),
  /** Khoảng tham chiếu đã áp cho bệnh nhân này (đã chụp lại khi lưu); `null` nếu chỉ số chưa khai khoảng nào. */
  reference: paraclinicalReferenceSchema.nullable(),
  /** Chữ khoảng tham chiếu để hiển thị/in. */
  referenceText: z.string(),
  valueText: z.string().nullable(),
  note: z.string().nullable(),
  interpretationText: z.string().nullable(),
  flag: paraclinicalValueFlagSchema.nullable(),
});
export type ParaclinicalResultValueView = z.infer<typeof paraclinicalResultValueViewSchema>;

export const paraclinicalResultImageSchema = z.object({
  id: z.string().uuid(),
  fileName: z.string(),
  /** Đường dẫn ký có hạn (`/api/v1/files/<token>`) — dùng thẳng làm `src` của thẻ ảnh. */
  url: z.string(),
});
export type ParaclinicalResultImage = z.infer<typeof paraclinicalResultImageSchema>;

/** Giới hạn ảnh đính kèm: số ảnh/kết quả và dung lượng mỗi ảnh. */
export const PARACLINICAL_IMAGE_MAX_COUNT = 8;
export const PARACLINICAL_IMAGE_MAX_BYTES = 5 * 1024 * 1024;

export const paraclinicalResultSectionSchema = z.object({
  itemId: z.string().uuid(),
  technicalServiceId: z.string().uuid(),
  code: z.string().nullable(),
  name: z.string(),
  serviceKind: technicalServiceKindSchema,
  resultType: technicalServiceResultTypeSchema,
  specimenTypeName: z.string().nullable(),
  departmentName: z.string().nullable(),
  /** Tên Nhóm dịch vụ (HUYẾT HỌC, SINH HOÁ...) — tiêu đề nhóm lĩnh vực trên phiếu in; `null` nếu chưa phân nhóm. */
  categoryName: z.string().nullable(),
  /** Trạng thái dòng chỉ định (IN_PROGRESS / RESULTED / COMPLETED). */
  status: z.enum(['ORDERED', 'IN_PROGRESS', 'RESULTED', 'COMPLETED', 'CANCELLED']),
  indicators: z.array(paraclinicalResultValueViewSchema),
  descriptionText: z.string().nullable(),
  conclusionText: z.string().nullable(),
  /** Ảnh đính kèm (siêu âm, X-quang...); rỗng với xét nghiệm. */
  images: z.array(paraclinicalResultImageSchema),
});
export type ParaclinicalResultSection = z.infer<typeof paraclinicalResultSectionSchema>;

export const paraclinicalApproverSchema = z.object({ id: z.string().uuid(), fullName: z.string() });
export type ParaclinicalApprover = z.infer<typeof paraclinicalApproverSchema>;

/** Thông tin đính chính của kết quả đang xem (bản đang soạn lại hoặc bản đính chính đã duyệt). Bản gốc đã ký được giữ nguyên trong DB, không xoá. */
export const paraclinicalAmendmentInfoSchema = z.object({
  reason: z.string(),
  originalSignedAt: z.string().nullable(),
  originalSignedByName: z.string().nullable(),
});
export type ParaclinicalAmendmentInfo = z.infer<typeof paraclinicalAmendmentInfoSchema>;

export const paraclinicalResultFormSchema = z.object({
  orderNo: z.string(),
  encounterId: z.string().uuid(),
  encounterNo: z.string().nullable(),
  patientName: z.string(),
  patientCode: z.string(),
  patientGender: z.enum(['male', 'female', 'other']).nullable(),
  /** Ngày sinh `YYYY-MM-DD` và điện thoại — in trên phiếu kết quả. */
  patientDob: z.string(),
  patientPhone: z.string().nullable(),
  ageYears: z.number().int().nullable(),
  /** Lúc bác sĩ chỉ định (mốc "Đăng ký" trên phiếu in). */
  registeredAt: z.string(),
  doctorName: z.string().nullable(),
  /** Lúc lấy mẫu / gọi vào phòng. */
  collectedAt: z.string().nullable(),
  bucket: paraclinicalQueueBucketSchema,
  sections: z.array(paraclinicalResultSectionSchema),
  performedById: z.string().uuid().nullable(),
  performedByName: z.string().nullable(),
  resultedAt: z.string().nullable(),
  approverId: z.string().uuid().nullable(),
  approvers: z.array(paraclinicalApproverSchema),
  signedAt: z.string().nullable(),
  signedByName: z.string().nullable(),
  /** `null` = kết quả gốc; có giá trị = bản đính chính. */
  amendment: paraclinicalAmendmentInfoSchema.nullable(),
});
export type ParaclinicalResultForm = z.infer<typeof paraclinicalResultFormSchema>;

export const paraclinicalValueInputSchema = z.object({
  indicatorId: z.string().uuid(),
  valueText: z.string().trim().max(200).nullable().optional(),
  note: z.string().trim().max(300).nullable().optional(),
});
export type ParaclinicalValueInput = z.infer<typeof paraclinicalValueInputSchema>;

export const paraclinicalSectionInputSchema = z.object({
  itemId: z.string().uuid(),
  values: z.array(paraclinicalValueInputSchema).max(200).default([]),
  descriptionText: z.string().trim().max(8000).nullable().optional(),
  conclusionText: z.string().trim().max(4000).nullable().optional(),
});
export type ParaclinicalSectionInput = z.infer<typeof paraclinicalSectionInputSchema>;

export const saveParaclinicalResultRequestSchema = z.object({
  sections: z.array(paraclinicalSectionInputSchema).min(1).max(50),
  /** Thời gian có kết quả (ISO); bỏ trống = bây giờ. */
  resultedAt: z.string().datetime().optional(),
  /** Bác sĩ được đề nghị duyệt. */
  approverId: z.string().uuid().nullable().optional(),
  /** `true` = gửi duyệt (chuyển "Chờ duyệt"); `false` = lưu nháp. Endpoint duyệt bỏ qua cờ này. */
  submit: z.boolean().default(false),
});
export type SaveParaclinicalResultRequest = z.infer<typeof saveParaclinicalResultRequestSchema>;

/**
 * Đính chính kết quả ĐÃ DUYỆT (docs/DECISIONS.md #215): người có quyền Nhập của nhóm đề nghị, bắt buộc kèm lý do (Thông tư 46/2018/TT-BYT); kết quả quay lại
 * "Đang thực hiện" để sửa rồi gửi duyệt, bác sĩ có quyền Duyệt ký lại. Bản gốc được giữ nguyên (không xoá) và khôi phục được nếu huỷ đính chính.
 */
export const amendParaclinicalResultRequestSchema = z.object({
  reason: z.string().trim().min(5, 'Nhập lý do đính chính (ít nhất 5 ký tự).').max(500),
});
export type AmendParaclinicalResultRequest = z.infer<typeof amendParaclinicalResultRequestSchema>;

export const getParaclinicalResultResponseSchema = z.object({ form: paraclinicalResultFormSchema });
export type GetParaclinicalResultResponse = z.infer<typeof getParaclinicalResultResponseSchema>;
