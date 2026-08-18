import { z } from 'zod';

/**
 * Lượt khám + Tiếp nhận (Sprint 3, phần 1: REC-01→03) — xem .claude/docs/clinical-workflow.md
 * mục "Tiếp nhận (check-in)", .claude/docs/data-model.md mục "encounter"/"vital_sign".
 */
export const ENCOUNTER_STATUSES = ['SCHEDULED', 'CHECKED_IN', 'IN_CONSULTATION', 'COMPLETED', 'CANCELLED', 'NO_SHOW'] as const;
export const encounterStatusSchema = z.enum(ENCOUNTER_STATUSES);
export type EncounterStatus = z.infer<typeof encounterStatusSchema>;

/** Prefix mã hiển thị `encounter_no` (Lượt Khám) — cùng khuôn `patient_code`/`booking_code`. */
export const ENCOUNTER_NO_PREFIX = 'LK';

/**
 * Chỉ số sinh hiệu — dùng chung cho lúc "tiếp nhận" (cả 2 luồng, mọi trường tuỳ chọn, không bắt
 * buộc ít nhất 1 như `recordVitalSignRequestSchema` bên dưới, vì cả biểu mẫu tiếp nhận cũng đã
 * tuỳ chọn) và cho endpoint ghi/bổ sung sinh hiệu độc lập (REC-02/03, dành cho lúc khám sau này bổ
 * sung nếu lúc tiếp nhận thiếu). `temperatureC` là độ C thập phân (ví dụ 37.5) — DB lưu
 * `temperature_deci_c` (phần mười độ, số nguyên) theo .claude/docs/data-model.md, quy đổi ở tầng
 * service (`apps/api`), không quy đổi ở Zod schema này.
 */
const intakeVitalSignFieldsSchema = z.object({
  pulse: z.number().int().min(0).max(300).optional(),
  temperatureC: z.number().min(30).max(45).optional(),
  bpSystolic: z.number().int().min(0).max(300).optional(),
  bpDiastolic: z.number().int().min(0).max(200).optional(),
  respiratoryRate: z.number().int().min(0).max(120).optional(),
  spo2: z.number().int().min(0).max(100).optional(),
  weightGram: z.number().int().min(0).max(300_000).optional(),
  heightMm: z.number().int().min(0).max(2_500).optional(),
});

/**
 * Trường "Thông tin tiếp nhận"/"Chỉ định dịch vụ khám" mở rộng (thiết kế lại theo mockup đã duyệt)
 * — dùng chung cho cả `checkInRequestSchema`/`registerReceptionRequestSchema`. `receptionTypeCode`
 * (Loại tiếp nhận)/`examFormCode` (Hình thức khám) bắt buộc (category `RECEPTION_TYPE`/
 * `EXAM_FORM`). `isPriority`/`priorityReasonCode` (Ưu tiên khám — category `PRIORITY_REASON`,
 * bắt buộc CHỈ khi `isPriority=true`, ràng buộc ở `.superRefine()` bên dưới). `priceTypeCode`
 * (Loại giá dịch vụ, category `PRICE_TYPE`)/`examTypeUnit` (Đơn vị, snapshot từ `reference_catalog.
 * unit` của `EXAM_TYPE` đã chọn)/`serviceQuantity` (mặc định 1) — cùng tinh thần SNAPSHOT với
 * `examTypeCode/Name/Price` đã có, CHỈ lưu để hiển thị trong bảng dịch vụ, KHÔNG tính viện phí/
 * xuất hoá đơn (ngoài phạm vi v1, CLAUDE.md).
 */
const intakeExtendedFieldsSchema = z.object({
  receptionTypeCode: z.string().min(1),
  examFormCode: z.string().min(1),
  isPriority: z.boolean().default(false),
  priorityReasonCode: z.string().optional(),
  priceTypeCode: z.string().optional(),
  examTypeUnit: z.string().optional(),
  serviceQuantity: z.number().int().positive().default(1),
});

/** Bắt buộc `priorityReasonCode` khi `isPriority=true` — dùng chung cho cả 2 request schema bên dưới. */
function requirePriorityReasonWhenPriority(data: { isPriority: boolean; priorityReasonCode?: string }, ctx: z.RefinementCtx) {
  if (data.isPriority && !data.priorityReasonCode) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['priorityReasonCode'],
      message: 'Đã chọn "Ưu tiên khám" thì bắt buộc chọn lý do ưu tiên.',
    });
  }
}

/**
 * Check-in (`POST /reception/check-in`) — `patientId` đã resolve xong ở web TRƯỚC khi gọi (chọn
 * từ danh sách trùng SĐT, tìm kiếm, hoặc tạo mới qua `POST /patients` riêng — xem
 * docs/DECISIONS.md). `version` là version hiện tại của `appointment` (optimistic locking, cùng
 * quy ước `cancelAppointmentRequestSchema`). Dùng chung 1 biểu mẫu với "Tiếp nhận bệnh nhân"
 * (`docs/DECISIONS.md` #044) — web hiển thị dạng popup trên panel Lịch hẹn thay vì dialog tối
 * giản trước đây, nên nhận thêm đúng các trường loại khám/nguồn khách/sinh hiệu như
 * `registerReceptionRequestSchema`.
 */
export const checkInRequestSchema = z
  .object({
    appointmentId: z.string().uuid(),
    patientId: z.string().uuid(),
    version: z.number().int(),
    chiefComplaint: z.string().optional(),
    patientSourceCode: z.string().optional(),
    examTypeCode: z.string().min(1),
    examTypeName: z.string().min(1),
    examTypePrice: z.number().int().nonnegative(),
  })
  .merge(intakeVitalSignFieldsSchema)
  .merge(intakeExtendedFieldsSchema)
  .superRefine(requirePriorityReasonWhenPriority);
export type CheckInRequest = z.infer<typeof checkInRequestSchema>;

/**
 * "Tiếp nhận bệnh nhân" (`POST /reception/direct`) — khách đến thẳng phòng khám, KHÔNG qua đặt
 * lịch trước, KHÔNG tạo `appointment` (khác hẳn hướng đã bác bỏ "tạo appointment+encounter cùng
 * lúc" — xem Context trong plan). Tạo thẳng `encounter` với `appointmentId=null`. `patientId` đã
 * resolve xong ở web (giống `checkInRequestSchema`). `examTypeCode`/`examTypeName`/`examTypePrice`
 * là SNAPSHOT tại thời điểm tạo (copy từ `reference_catalog` category `EXAM_TYPE` lúc chọn trên
 * web, không JOIN lại lúc đọc) — đổi giá/tên danh mục sau này không ảnh hồ sơ cũ, cùng tinh thần
 * `insurance_snapshot`. `patientSourceCode` (category `PATIENT_SOURCE`) tuỳ chọn. Chỉ số sinh hiệu
 * (tuỳ chọn) nhập cùng lúc — thiếu thì bác sĩ tự bổ sung ở form phiếu khám sau (`docs/DECISIONS.md` #044).
 */
export const registerReceptionRequestSchema = z
  .object({
    patientId: z.string().uuid(),
    doctorId: z.string().uuid(),
    checkedInAt: z.string(),
    chiefComplaint: z.string().optional(),
    patientSourceCode: z.string().optional(),
    examTypeCode: z.string().min(1),
    examTypeName: z.string().min(1),
    examTypePrice: z.number().int().nonnegative(),
  })
  .merge(intakeVitalSignFieldsSchema)
  .merge(intakeExtendedFieldsSchema)
  .superRefine(requirePriorityReasonWhenPriority);
export type RegisterReceptionRequest = z.infer<typeof registerReceptionRequestSchema>;

/** "Bắt đầu khám" — CHECKED_IN → IN_CONSULTATION. `version` là version của `encounter`. */
export const startConsultationRequestSchema = z.object({ version: z.number().int() });
export type StartConsultationRequest = z.infer<typeof startConsultationRequestSchema>;

/** "Bỏ về" — CHECKED_IN → CANCELLED, bắt buộc lý do (.claude/docs/clinical-workflow.md). */
export const cancelEncounterRequestSchema = z.object({
  cancelReason: z.string().min(1),
  version: z.number().int(),
});
export type CancelEncounterRequest = z.infer<typeof cancelEncounterRequestSchema>;

export const encounterSummarySchema = z.object({
  id: z.string().uuid(),
  encounterNo: z.string(),
  patientId: z.string().uuid(),
  doctorId: z.string().uuid(),
  appointmentId: z.string().uuid().nullable(),
  status: encounterStatusSchema,
  specialty: z.string(),
  checkedInAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  chiefComplaint: z.string().nullable(),
  version: z.number().int(),
});
export type EncounterSummary = z.infer<typeof encounterSummarySchema>;

/**
 * Ghi/bổ sung sinh hiệu độc lập (REC-02/03, `POST /reception/encounters/:encounterId/vital-signs`)
 * — dùng khi lúc tiếp nhận chưa nhập hoặc cần bổ sung thêm sau (ví dụ lúc khám). Cùng bộ trường
 * `intakeVitalSignFieldsSchema` nhưng bắt buộc có ÍT NHẤT một chỉ số (không cho lưu bản ghi rỗng)
 * — khác lúc tiếp nhận (cả biểu mẫu đã tuỳ chọn, không cần ràng buộc riêng cho phần sinh hiệu).
 */
export const recordVitalSignRequestSchema = intakeVitalSignFieldsSchema.refine(
  (data) => Object.values(data).some((v) => v !== undefined),
  { message: 'Phải nhập ít nhất một chỉ số sinh hiệu.' },
);
export type RecordVitalSignRequest = z.infer<typeof recordVitalSignRequestSchema>;

/**
 * Cảnh báo ngoài ngưỡng (REC-03) — CHỈ cảnh báo, không bao giờ chặn lưu (xem
 * packages/core/src/vital-sign/vital-sign-thresholds.ts, docs/DECISIONS.md). `kind`
 * phân biệt "ngoài ngưỡng sinh lý theo tuổi" (`out_of_range`) và "giá trị phi lý — nghi nhập nhầm
 * đơn vị" (`implausible`, chỉ áp cho cân nặng/chiều cao — không làm percentile tăng trưởng).
 */
export const vitalSignWarningSchema = z.object({
  field: z.string(),
  kind: z.enum(['out_of_range', 'implausible']),
  message: z.string(),
});
export type VitalSignWarning = z.infer<typeof vitalSignWarningSchema>;

export const vitalSignResponseSchema = z.object({
  id: z.string().uuid(),
  encounterId: z.string().uuid(),
  pulse: z.number().int().nullable(),
  temperatureC: z.number().nullable(),
  bpSystolic: z.number().int().nullable(),
  bpDiastolic: z.number().int().nullable(),
  respiratoryRate: z.number().int().nullable(),
  spo2: z.number().int().nullable(),
  weightGram: z.number().int().nullable(),
  heightMm: z.number().int().nullable(),
  measuredAt: z.string(),
  warnings: z.array(vitalSignWarningSchema),
});
export type VitalSignResponse = z.infer<typeof vitalSignResponseSchema>;

/**
 * Danh sách Tiếp nhận (`GET /reception/list`) — CHỈ hồ sơ ĐÃ được tiếp nhận (đã có `encounter`),
 * theo dõi trạng thái từ lúc vào tới lúc khám xong trong ngày: "Đã tiếp nhận" (`CHECKED_IN`) →
 * "Đang khám" (`IN_CONSULTATION`) → "Đã khám xong" (`COMPLETED`); `CANCELLED` ("bỏ về") cũng hiện
 * để lễ tân biết. KHÔNG gồm lịch hẹn `SCHEDULED` chưa tới — check-in một lịch hẹn thực hiện từ
 * panel chi tiết Lịch hẹn (`AppointmentDetailPanel.tsx`), không phải từ trang này (đã hỏi và chốt
 * lại với chủ dự án — xem docs/DECISIONS.md). "Chờ phân phòng"/"chờ kết quả"/"đã thanh toán" theo
 * yêu cầu ban đầu KHÔNG đưa vào v1 — 2 mục sau đụng module ngoài phạm vi (cận lâm sàng LIS v3+,
 * viện phí v2), mục "chờ phân phòng" chưa có trong state machine đã chốt, chủ dự án xác nhận
 * chưa cần ở v1.
 */
export const receptionListItemSchema = z.object({
  encounterId: z.string().uuid(),
  encounterNo: z.string(),
  appointmentId: z.string().uuid().nullable(),
  patientId: z.string().uuid(),
  fullName: z.string(),
  phone: z.string(),
  doctorId: z.string().uuid(),
  status: encounterStatusSchema,
  checkedInAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  version: z.number().int(),
});
export type ReceptionListItem = z.infer<typeof receptionListItemSchema>;

export const receptionListResponseSchema = z.object({ items: z.array(receptionListItemSchema) });
export type ReceptionListResponse = z.infer<typeof receptionListResponseSchema>;

/**
 * `date` tuỳ chọn (`YYYY-MM-DD`, giờ Việt Nam) — bỏ trống thì server mặc định "hôm nay"
 * (`getVietnamDateString()`, `packages/core`). `doctorId` tuỳ chọn — trang "Hàng đợi khám" lọc
 * theo 1 bác sĩ cụ thể; chỉ có tác dụng khi actor có scope `global` trên `encounter.read` (scope
 * `personal` luôn tự ép về chính actor ở service, bỏ qua giá trị này).
 */
export const receptionListQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date phải theo định dạng YYYY-MM-DD')
    .optional(),
  doctorId: z.string().uuid().optional(),
});
export type ReceptionListQuery = z.infer<typeof receptionListQuerySchema>;
