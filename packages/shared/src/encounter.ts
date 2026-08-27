import { z } from 'zod';
import { patientAllergenItemSchema, patientConditionItemSchema, patientFamilyHistoryItemSchema } from './patient';
import { prescriptionResponseSchema } from './prescription';

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
 * Trường "Thông tin tiếp nhận" mở rộng (thiết kế lại theo mockup đã duyệt) — dùng chung cho cả
 * `checkInRequestSchema`/`registerReceptionRequestSchema`. `receptionTypeCode` (Loại tiếp nhận)/
 * `examFormCode` (Hình thức khám) bắt buộc (category `RECEPTION_TYPE`/`EXAM_FORM`).
 * `isPriority`/`priorityReasonCode` (Ưu tiên khám — category `PRIORITY_REASON`, bắt buộc CHỈ khi
 * `isPriority=true`, ràng buộc ở `.superRefine()` bên dưới). "Chỉ định dịch vụ khám" tách riêng
 * thành `services[]` (docs/DECISIONS.md #080) — xem `encounterServiceItemInputSchema`.
 */
const intakeExtendedFieldsSchema = z.object({
  receptionTypeCode: z.string().min(1),
  examFormCode: z.string().min(1),
  isPriority: z.boolean().default(false),
  priorityReasonCode: z.string().optional(),
  /**
   * "Thanh toán sau" (Thu ngân cơ bản, Sprint 5/6) — ý nghĩa thật đã ghi nhận từ #080: `true` =
   * lượt khám được PHÉP vào Hàng đợi khám dù phiếu thu chưa "Đã thu". Chỉ có hiệu lực khi
   * `tenant_setting.deferred_payment_enabled=true` (server tự AND lại 2 điều kiện lúc gate — xem
   * `EncounterService.startConsultation`); web tự ẩn hẳn checkbox này khi tính năng tắt ở cấp
   * phòng khám, luôn gửi `false`. Mặc định `false` (không phải mặc định cho nợ).
   */
  allowsDeferredPayment: z.boolean().default(false),
});

/**
 * "Chỉ định dịch vụ khám" (docs/DECISIONS.md #080) — 1 lượt khám cho phép NHIỀU dịch vụ (đảo
 * ngược #052 điểm 6, khi đó cố ý làm phẳng "Loại giá dịch vụ" để tránh dựng "Price Book"). Web
 * chọn Loại khám (category `EXAM_TYPE`) → lọc `prices[]` của mục đó (bảng `exam_type_price`, #079)
 * còn hiệu lực hôm nay → "Loại giá dịch vụ" chỉ hiện đúng các mức đã cấu hình, "Đơn vị"/"Đơn giá"
 * tự điền theo dòng giá đã chọn. `priceTypeCode`/`unitCode`/`examTypePrice` NULLABLE — dịch vụ
 * chưa được cấu hình đơn giá hiệu lực vẫn thêm được (mục này chỉ lưu để hiển thị, KHÔNG tính viện
 * phí/xuất hoá đơn — ngoài phạm vi v1, CLAUDE.md). Mọi field SNAPSHOT tại thời điểm thêm, không
 * JOIN lại lúc đọc — cùng tinh thần `insuranceSnapshot`.
 */
export const encounterServiceItemInputSchema = z.object({
  examTypeCode: z.string().min(1),
  examTypeName: z.string().min(1),
  priceTypeCode: z.string().optional(),
  unitCode: z.string().optional(),
  examTypePrice: z.number().int().nonnegative().optional(),
  quantity: z.number().int().positive().default(1),
});
export type EncounterServiceItemInput = z.infer<typeof encounterServiceItemInputSchema>;

export const encounterServiceItemSchema = encounterServiceItemInputSchema.extend({ id: z.string().uuid() });
export type EncounterServiceItem = z.infer<typeof encounterServiceItemSchema>;

const intakeServiceFieldsSchema = z.object({
  services: z.array(encounterServiceItemInputSchema).min(1, 'Cần chỉ định ít nhất 1 dịch vụ khám.'),
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
 * "Hàng đợi ảo" (#064) — khu vực Điều phối Bác sĩ/Khoa, dùng chung cho cả `checkInRequestSchema`
 * lẫn `registerReceptionRequestSchema`. Chọn "đích danh bác sĩ" (`doctorId`) — server tự suy
 * `departmentId` từ hồ sơ bác sĩ, KHÔNG dùng `departmentId` client gửi cho nhánh này (xem
 * `DoctorDirectoryPort.getDoctorDepartmentId`). Chọn "theo Khoa" (`departmentId`, chưa rõ bác sĩ)
 * — `doctorId` để trống, lượt khám rơi vào hàng chờ chung của Khoa đó. Bắt buộc có ÍT NHẤT một
 * trong hai trường.
 */
const intakeRoutingFieldsSchema = z.object({
  doctorId: z.string().uuid().optional(),
  departmentId: z.string().uuid().optional(),
});

/** Bắt buộc có ÍT NHẤT một trong `doctorId`/`departmentId` — dùng chung cho cả 2 request schema bên dưới. */
function requireDoctorOrDepartment(data: { doctorId?: string; departmentId?: string }, ctx: z.RefinementCtx) {
  if (data.doctorId === undefined && data.departmentId === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['doctorId'],
      message: 'Phải chọn bác sĩ cụ thể hoặc chọn Khoa.',
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
  })
  .merge(intakeVitalSignFieldsSchema)
  .merge(intakeExtendedFieldsSchema)
  .merge(intakeServiceFieldsSchema)
  .merge(intakeRoutingFieldsSchema)
  .superRefine(requirePriorityReasonWhenPriority)
  .superRefine(requireDoctorOrDepartment);
export type CheckInRequest = z.infer<typeof checkInRequestSchema>;

/**
 * "Tiếp nhận bệnh nhân" (`POST /reception/direct`) — khách đến thẳng phòng khám, KHÔNG qua đặt
 * lịch trước, KHÔNG tạo `appointment` (khác hẳn hướng đã bác bỏ "tạo appointment+encounter cùng
 * lúc" — xem Context trong plan). Tạo thẳng `encounter` với `appointmentId=null`. `patientId` đã
 * resolve xong ở web (giống `checkInRequestSchema`). "Chỉ định dịch vụ khám" là `services[]`
 * (docs/DECISIONS.md #080, xem `encounterServiceItemInputSchema`). `patientSourceCode` (category
 * `PATIENT_SOURCE`) tuỳ chọn. Chỉ số sinh hiệu (tuỳ chọn) nhập cùng lúc — thiếu thì bác sĩ tự bổ
 * sung ở form phiếu khám sau (`docs/DECISIONS.md` #044).
 */
export const registerReceptionRequestSchema = z
  .object({
    patientId: z.string().uuid(),
    checkedInAt: z.string(),
    chiefComplaint: z.string().optional(),
    patientSourceCode: z.string().optional(),
  })
  .merge(intakeVitalSignFieldsSchema)
  .merge(intakeExtendedFieldsSchema)
  .merge(intakeServiceFieldsSchema)
  .merge(intakeRoutingFieldsSchema)
  .superRefine(requirePriorityReasonWhenPriority)
  .superRefine(requireDoctorOrDepartment);
export type RegisterReceptionRequest = z.infer<typeof registerReceptionRequestSchema>;

/** "Bắt đầu khám" — CHECKED_IN → IN_CONSULTATION. `version` là version của `encounter`. */
export const startConsultationRequestSchema = z.object({ version: z.number().int() });
export type StartConsultationRequest = z.infer<typeof startConsultationRequestSchema>;

/**
 * "Khách bỏ về" — `CHECKED_IN → CANCELLED`, và từ #085 cả `IN_CONSULTATION → CANCELLED` (khách bỏ
 * về giữa chừng sau khi bác sĩ đã nhận ca). Bắt buộc lý do (.claude/docs/clinical-workflow.md).
 *
 * Phiếu thu đi kèm được xử lý trong CÙNG transaction: `UNPAID → CANCELLED`; `PAID` giữ nguyên và
 * chờ hoàn tiền riêng qua `POST /billing/invoices/:encounterId/refund` (quyền `invoice.refund`).
 */
export const cancelEncounterRequestSchema = z.object({
  cancelReason: z.string().min(1),
  version: z.number().int(),
});
export type CancelEncounterRequest = z.infer<typeof cancelEncounterRequestSchema>;

/**
 * #085 "Trả về hàng chờ" — `IN_CONSULTATION → CHECKED_IN`, đồng thời nhả `doctorId` về `null` để
 * lượt khám quay lại hàng chờ chung Khoa cho bác sĩ khác nhận ("Hàng đợi ảo" #064). Dùng khi bác
 * sĩ nhận nhầm ca của người khác hoặc bận đột xuất — KHÁC hẳn "Khách bỏ về" (khách vẫn đang chờ
 * khám, không huỷ gì). Không có lý do bắt buộc: đây là thao tác điều phối nội bộ, không đóng ca,
 * không đụng tiền — vết đã đủ ở `audit_log`.
 */
export const releaseEncounterRequestSchema = z.object({ version: z.number().int() });
export type ReleaseEncounterRequest = z.infer<typeof releaseEncounterRequestSchema>;

export const encounterSummarySchema = z.object({
  id: z.string().uuid(),
  encounterNo: z.string(),
  patientId: z.string().uuid(),
  /** "Hàng đợi ảo" (#064) — `null` khi lượt khám còn trong hàng chờ chung Khoa, chưa được bác sĩ nào nhận. */
  doctorId: z.string().uuid().nullable(),
  departmentId: z.string().uuid(),
  appointmentId: z.string().uuid().nullable(),
  status: encounterStatusSchema,
  specialty: z.string(),
  checkedInAt: z.string(),
  startedAt: z.string().nullable(),
  completedAt: z.string().nullable(),
  chiefComplaint: z.string().nullable(),
  /** Loại khám (snapshot `reference_catalog` category `EXAM_TYPE` lúc tiếp nhận, #052). */
  examTypeName: z.string().nullable(),
  /** Loại tiếp nhận — mã tham chiếu `reference_catalog` category `RECEPTION_TYPE` (vd `RT_NEW`=Khám mới, `RT_FOLLOWUP`=Tái khám). Không có cột tên snapshot (khác `examTypeName`) — web tự resolve tên hiển thị qua `GET /reference-catalog/RECEPTION_TYPE`. Hiện ở banner màn khám cạnh SĐT (báo bác sĩ biết khám mới hay tái khám). */
  receptionTypeCode: z.string().nullable(),
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
  patientCode: z.string(),
  fullName: z.string(),
  phone: z.string(),
  /** "Hàng đợi ảo" (#064) — `null` = đang trong hàng chờ chung Khoa, chưa được bác sĩ nào nhận. */
  doctorId: z.string().uuid().nullable(),
  departmentId: z.string().uuid(),
  isPriority: z.boolean(),
  chiefComplaint: z.string().nullable(),
  /** Người thực hiện tiếp nhận (`encounter.createdBy`, resolve tên qua `DoctorDirectoryPort.getUserFullNames`) — check-in từ lịch hẹn hay "Tiếp nhận bệnh nhân" đều tính là 1 lần tiếp nhận. `null` nếu tài khoản không còn resolve được tên (trường hợp hiếm). */
  receivedByName: z.string().nullable(),
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
  /**
   * "Hàng đợi khám" (#064) — bác sĩ đang xem cờ này để gộp thêm "Hàng chờ chung · Khoa của mình"
   * (`departmentId=Khoa actor AND doctorId IS NULL`) vào cùng kết quả với "Bệnh nhân của tôi". Cờ
   * TƯỜNG MINH do client gửi (không suy diễn ngầm từ vai trò/scope) — mặc định `false` để "Danh
   * sách tiếp nhận" (lễ tân) giữ nguyên hành vi cũ.
   */
  includeDepartmentPool: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .default(false)
    .transform((v) => (typeof v === 'string' ? v === 'true' : v)),
  /**
   * Thu ngân cơ bản (Sprint 5/6) — cờ TƯỜNG MINH riêng cho "Hàng đợi khám" (bác sĩ), cùng tinh
   * thần `includeDepartmentPool`: khi `true`, server loại khỏi kết quả các lượt khám `CHECKED_IN`
   * chưa thu tiền và không được phép nợ (`EncounterRepository.listForDay({requirePaymentCleared})`).
   * "Danh sách tiếp nhận" (lễ tân) KHÔNG set cờ này — vẫn phải thấy đủ mọi lượt khám kể cả chưa
   * thu tiền để xử lý ở Thu ngân. Mặc định `false`.
   */
  queueView: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .default(false)
    .transform((v) => (typeof v === 'string' ? v === 'true' : v)),
});
export type ReceptionListQuery = z.infer<typeof receptionListQuerySchema>;

/**
 * Khám bệnh (S3-05→07) — xem .claude/docs/clinical-workflow.md mục "Khám bệnh". Ký hồ sơ (ENC-04)
 * và luồng đính chính là việc của Sprint 5 — mọi ghi chú/chẩn đoán ở đây đều là bản nháp
 * (`signedAt=null`), chưa có ràng buộc bất biến.
 */
export const DIAGNOSIS_TYPES = ['PRIMARY', 'SECONDARY'] as const;
export const diagnosisTypeSchema = z.enum(DIAGNOSIS_TYPES);
export type DiagnosisType = z.infer<typeof diagnosisTypeSchema>;

export const diagnosisItemSchema = z.object({
  id: z.string().uuid(),
  icd10Code: z.string(),
  /** Tên hiển thị — join từ `icd10_catalog` ở tầng service, không lưu denormalized. */
  icd10Name: z.string(),
  type: diagnosisTypeSchema,
  note: z.string().nullable(),
  version: z.number().int(),
});
export type DiagnosisItem = z.infer<typeof diagnosisItemSchema>;

/**
 * `PUT /encounters/:id/diagnoses` — thay thế TOÀN BỘ danh sách chẩn đoán của lượt khám (đơn giản
 * hơn diff từng dòng, khối lượng nhỏ vài dòng/encounter). Bắt buộc đúng 1 phần tử `type='PRIMARY'`
 * (.claude/docs/clinical-workflow.md: "bắt buộc có ít nhất một `diagnosis` với `type=primary`" —
 * ở đây ràng buộc chặt hơn thành ĐÚNG MỘT, khớp C10/docs/ERD.md "unique partial một PRIMARY mỗi
 * encounter"). Validate sớm ở Zod — DB constraint (unique partial index) là lớp phòng thủ thứ hai.
 */
export const saveDiagnosesRequestSchema = z
  .object({
    diagnoses: z
      .array(
        z.object({
          icd10Code: z.string().min(1),
          type: diagnosisTypeSchema,
          note: z.string().optional(),
        }),
      )
      .min(1, 'Phải có ít nhất một chẩn đoán.'),
  })
  .refine((data) => data.diagnoses.filter((d) => d.type === 'PRIMARY').length === 1, {
    message: 'Phải có đúng một chẩn đoán chính (PRIMARY).',
    path: ['diagnoses'],
  });
export type SaveDiagnosesRequest = z.infer<typeof saveDiagnosesRequestSchema>;

export const saveDiagnosesResponseSchema = z.object({ items: z.array(diagnosisItemSchema) });
export type SaveDiagnosesResponse = z.infer<typeof saveDiagnosesResponseSchema>;

/**
 * Đổi từ 4 mục SOAP (S/O/A/P) sang nhóm "Tiền sử"/"Thăm khám" — yêu cầu chủ dự án 2026-08-20 (xem
 * docs/DECISIONS.md). `PLAN` để sẵn cho tab "Kế hoạch điều trị & hẹn tái khám" (chưa xây web).
 * "Tiền sử dị ứng" KHÔNG có ở đây — trùng `patient.allergyNote` đã có sẵn, đọc/ghi thẳng qua
 * `PATCH /patients/:id`, không tạo section riêng (tránh 2 nguồn sự thật cho cùng một dữ liệu).
 * "Tiền sử bản thân"/"Tiền sử gia đình" cũng đã CHUYỂN sang `patient.personalHistory`/
 * `patient.familyHistory` cùng lý do (docs/DECISIONS.md #068) — trước đây gắn theo từng lượt khám
 * (`PERSONAL_HISTORY`/`FAMILY_HISTORY` ở đây) khiến bác sĩ phải nhập lại từ đầu mỗi lượt khám mới
 * dù nội dung hầu như không đổi.
 */
export const CLINICAL_NOTE_SECTIONS = [
  'REASON_FOR_VISIT',
  'ILLNESS_PROGRESS',
  'PRELIMINARY_DIAGNOSIS',
  'GENERAL_EXAM',
  'REGIONAL_EXAM',
  'PLAN',
] as const;
export const clinicalNoteSectionSchema = z.enum(CLINICAL_NOTE_SECTIONS);
export type ClinicalNoteSection = z.infer<typeof clinicalNoteSectionSchema>;

/** `version` vắng mặt = section đó chưa có dòng nào (tạo mới); có `version` = update, kiểm optimistic lock. */
const clinicalNoteSectionInputSchema = z.object({
  content: z.string(),
  version: z.number().int().optional(),
});
/** "Lý do khám" và "Chẩn đoán sơ bộ" bắt buộc có nội dung (yêu cầu chủ dự án) — các mục còn lại tuỳ chọn. */
const requiredClinicalNoteSectionInputSchema = z.object({
  content: z.string().min(1, 'Không được để trống.'),
  version: z.number().int().optional(),
});

/** `PUT /encounters/:id/clinical-note` — lưu các mục "Thăm khám" trong một request (khớp form 1 lần bấm Lưu, không autosave). "Tiền sử bản thân/gia đình" không còn ở đây — xem `patient.personalHistory`/`familyHistory`. */
export const saveClinicalNoteRequestSchema = z.object({
  reasonForVisit: requiredClinicalNoteSectionInputSchema,
  illnessProgress: clinicalNoteSectionInputSchema,
  preliminaryDiagnosis: requiredClinicalNoteSectionInputSchema,
  generalExam: clinicalNoteSectionInputSchema,
  regionalExam: clinicalNoteSectionInputSchema,
  plan: clinicalNoteSectionInputSchema,
});
export type SaveClinicalNoteRequest = z.infer<typeof saveClinicalNoteRequestSchema>;

const clinicalNoteSectionValueSchema = z.object({ content: z.string(), version: z.number().int() }).nullable();

export const clinicalNoteResponseSchema = z.object({
  reasonForVisit: clinicalNoteSectionValueSchema,
  illnessProgress: clinicalNoteSectionValueSchema,
  preliminaryDiagnosis: clinicalNoteSectionValueSchema,
  generalExam: clinicalNoteSectionValueSchema,
  regionalExam: clinicalNoteSectionValueSchema,
  plan: clinicalNoteSectionValueSchema,
});
export type ClinicalNoteResponse = z.infer<typeof clinicalNoteResponseSchema>;

/** Một dòng tiền sử tóm tắt (ENC-01) — danh sách các lần khám TRƯỚC (không gồm lượt khám hiện tại). */
export const encounterHistoryItemSchema = z.object({
  encounterId: z.string().uuid(),
  checkedInAt: z.string(),
  /** Tên bác sĩ đã khám lần đó — `null` nếu lượt khám cũ chưa từng gán bác sĩ (hàng đợi ảo, #064). */
  doctorName: z.string().nullable(),
  chiefComplaint: z.string().nullable(),
  primaryDiagnosisName: z.string().nullable(),
});
export type EncounterHistoryItem = z.infer<typeof encounterHistoryItemSchema>;

/** Bệnh nhân — chỉ các trường màn khám cần, không phải toàn bộ `patientDetailSchema`. */
export const consultationPatientSchema = z.object({
  id: z.string().uuid(),
  patientCode: z.string(),
  fullName: z.string(),
  dob: z.string(),
  gender: z.string(),
  phone: z.string(),
  /** Tiền sử bản thân (docs/DECISIONS.md #068) — ghi chú bổ sung tự do, sửa tại chỗ trong màn khám. */
  personalHistory: z.string().nullable(),
  /** Dị nguyên đã biết (Sprint 4, chốt 2026-08-25) — dùng cho PRE-03, xem `patientAllergenItemSchema`. */
  allergens: z.array(patientAllergenItemSchema),
  /** Bệnh lý nền + thói quen/lối sống có cấu trúc (Sprint 5) — CHỈ XEM ở màn khám, sửa qua hồ sơ bệnh nhân/Tiếp nhận, cùng khuôn `familyHistoryRows`. */
  conditions: z.array(patientConditionItemSchema),
  /** Tiền sử gia đình có cấu trúc (Sprint 5) — CHỈ XEM ở màn khám, sửa qua hồ sơ bệnh nhân/Tiếp nhận, không còn autosave textarea ở đây. */
  familyHistoryRows: z.array(patientFamilyHistoryItemSchema),
  /** Optimistic lock cho `PATCH /patients/:id` khi bác sĩ cập nhật "Tiền sử bản thân" ngay màn khám. */
  version: z.number().int(),
});
export type ConsultationPatient = z.infer<typeof consultationPatientSchema>;

/**
 * `GET /encounters/:id/consultation` (S3-05) — gộp mọi dữ liệu màn hình khám cần trong MỘT
 * request: tiền sử + dị ứng + sinh hiệu (.claude/docs/data-model.md yêu cầu S3-05 "gộp tiền sử, dị
 * ứng, sinh hiệu trong một request, tối ưu index").
 */
export const consultationDetailResponseSchema = z.object({
  encounter: encounterSummarySchema,
  patient: consultationPatientSchema,
  vitalSigns: vitalSignResponseSchema.nullable(),
  history: z.array(encounterHistoryItemSchema),
  diagnoses: z.array(diagnosisItemSchema),
  clinicalNote: clinicalNoteResponseSchema,
  /** Kê đơn (Sprint 4) — đơn thuốc đang hiệu lực của lượt khám này, `null` nếu chưa kê. */
  prescription: prescriptionResponseSchema,
});
export type ConsultationDetailResponse = z.infer<typeof consultationDetailResponseSchema>;

/** "Hoàn tất khám" — IN_CONSULTATION → COMPLETED. `version` là version của `encounter`. */
export const completeConsultationRequestSchema = z.object({ version: z.number().int() });
export type CompleteConsultationRequest = z.infer<typeof completeConsultationRequestSchema>;
