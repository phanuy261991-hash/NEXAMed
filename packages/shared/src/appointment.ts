import { z } from 'zod';

/**
 * Lịch hẹn (S2-05, APP-01/02/03) — xem .claude/docs/clinical-workflow.md mục "Đặt lịch",
 * docs/ERD.md mục 3.3/4 (C2: exclusion constraint chống trùng giờ bác sĩ ở tầng DB).
 */
export const APPOINTMENT_STATUSES = ['SCHEDULED', 'CANCELLED', 'NO_SHOW', 'CONVERTED'] as const;
export const appointmentStatusSchema = z.enum(APPOINTMENT_STATUSES);
export type AppointmentStatus = z.infer<typeof appointmentStatusSchema>;

export const APPOINTMENT_SOURCES = ['walk_in', 'phone', 'online'] as const;
export const appointmentSourceSchema = z.enum(APPOINTMENT_SOURCES);
export type AppointmentSource = z.infer<typeof appointmentSourceSchema>;

/**
 * Mặc định 15 phút theo docs/product/prd.md APP-02 — chưa đọc `tenant_setting.slot_duration_minutes`
 * (module `tenant`/cấu hình phòng khám là S2-07, chưa tồn tại lúc viết S2-05).
 */
export const DEFAULT_APPOINTMENT_DURATION_MINUTES = 15;

/** Prefix mã đặt lịch (`docs/DECISIONS.md` #032) — cùng khuôn `patient_code` (`BN`, `PATIENT_CODE_PREFIX`
 * ở `patient.service.ts`), format `<prefix><yyMM><seq6>` qua `formatDisplayCode()`. */
export const APPOINTMENT_BOOKING_CODE_PREFIX = 'LH';

/**
 * Đặt lịch "lead capture" (docs/DECISIONS.md #032) — KHÔNG tạo/gắn hồ sơ `patient` lúc đặt, chỉ
 * ghi nhận trực tiếp Tên/SĐT/lý do khám trên `appointment`. Việc tạo/khớp hồ sơ `patient` thật sự
 * chuyển sang lúc Tiếp nhận (check-in tại quầy, module `encounter` — Sprint 3, chưa xây).
 */
export const createAppointmentRequestSchema = z.object({
  doctorId: z.string().uuid(),
  /** Tuỳ chọn — đặt lịch qua điện thoại/online chưa chắc gán phòng ngay, xem schema.prisma. */
  roomId: z.string().uuid().optional(),
  fullName: z.string().min(1),
  /** Cùng validation `patient.phone` (packages/shared/src/patient.ts) — giữ nhất quán một chỗ. */
  phone: z.string().min(8).max(15),
  reason: z.string().optional(),
  scheduledAt: z.string().datetime(),
  durationMinutes: z.number().int().min(5).max(240).default(DEFAULT_APPOINTMENT_DURATION_MINUTES),
  source: appointmentSourceSchema,
});
export type CreateAppointmentRequest = z.infer<typeof createAppointmentRequestSchema>;

export const appointmentSummarySchema = z.object({
  id: z.string().uuid(),
  bookingCode: z.string(),
  /** Luôn `null` ở v1 hiện tại (chưa có luồng nào gắn) — để sẵn cho Tiếp nhận (Sprint 3) gắn hồ
   * sơ `patient` thật lúc check-in, xem docs/DECISIONS.md #032. */
  patientId: z.string().uuid().nullable(),
  fullName: z.string(),
  phone: z.string(),
  reason: z.string().nullable(),
  doctorId: z.string().uuid(),
  roomId: z.string().uuid().nullable(),
  scheduledAt: z.string(),
  durationMinutes: z.number().int(),
  status: appointmentStatusSchema,
  source: appointmentSourceSchema,
  cancelReason: z.string().nullable(),
  version: z.number().int(),
});
export type AppointmentSummary = z.infer<typeof appointmentSummarySchema>;

/** Phân trang cursor — không dùng offset, xem .claude/docs/architecture.md. */
export const listAppointmentsResponseSchema = z.object({
  items: z.array(appointmentSummarySchema),
  nextCursor: z.string().nullable(),
});
export type ListAppointmentsResponse = z.infer<typeof listAppointmentsResponseSchema>;

export const listAppointmentsQuerySchema = z.object({
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  doctorId: z.string().uuid().optional(),
  /**
   * Lọc theo một ngày (giờ Việt Nam, S2-09 — chế độ lưới) — `YYYY-MM-DD`. Quy đổi biên ngày qua
   * `vietnamDayRange()` (`packages/core`), không cắt mốc theo UTC server (CLAUDE.md).
   */
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date phải theo định dạng YYYY-MM-DD')
    .optional(),
});
export type ListAppointmentsQuery = z.infer<typeof listAppointmentsQuerySchema>;

/**
 * Huỷ lịch (S2-06, APP-04) — bắt buộc lý do (.claude/docs/clinical-workflow.md mục "Đặt lịch":
 * "Huỷ lịch bắt buộc có cancel_reason"), kèm `version` cho optimistic locking (cùng quy ước
 * `updatePatientRequestSchema`).
 */
export const cancelAppointmentRequestSchema = z.object({
  cancelReason: z.string().min(1),
  version: z.number().int().positive(),
});
export type CancelAppointmentRequest = z.infer<typeof cancelAppointmentRequestSchema>;

/**
 * Đổi/dời lịch hẹn (S2-09, sau khi xem mockup chủ dự án chốt thêm — xem docs/DECISIONS.md).
 * Cho sửa lại cả 3 (giờ/bác sĩ/phòng), không chỉ riêng giờ — cùng bộ trường với
 * `createAppointmentRequestSchema` (trừ `patientId`/`source`, không đổi khi dời lịch) + `version`
 * bắt buộc (optimistic locking, cùng quy ước `cancelAppointmentRequestSchema`).
 */
export const rescheduleAppointmentRequestSchema = z.object({
  doctorId: z.string().uuid(),
  roomId: z.string().uuid().optional(),
  scheduledAt: z.string().datetime(),
  durationMinutes: z.number().int().min(5).max(240),
  version: z.number().int().positive(),
});
export type RescheduleAppointmentRequest = z.infer<typeof rescheduleAppointmentRequestSchema>;

/**
 * Danh sách bác sĩ cho màn hình Lịch hẹn (S2-09, `GET /appointments/doctors`) — chiếu tối thiểu
 * (chỉ id + tên hiển thị), gắn quyền `appointment.read` thay vì `user_account.read` (xem
 * docs/DECISIONS.md — lễ tân có `appointment.read` nhưng không có `user_account.read`).
 */
export const doctorOptionSchema = z.object({
  id: z.string().uuid(),
  fullName: z.string(),
});
export type DoctorOption = z.infer<typeof doctorOptionSchema>;

export const listDoctorsResponseSchema = z.object({
  items: z.array(doctorOptionSchema),
});
export type ListDoctorsResponse = z.infer<typeof listDoctorsResponseSchema>;

/**
 * Tra cứu theo SĐT lúc đặt lịch (docs/DECISIONS.md #032) — tự điền Họ tên nếu SĐT đã từng đặt,
 * cảnh báo spam nếu số lần huỷ đạt ngưỡng. Không trả danh sách lịch hẹn đầy đủ (không cần cho UI,
 * tránh lộ dữ liệu thừa) — chỉ 2 trường tối thiểu form cần.
 */
export const appointmentPhoneLookupQuerySchema = z.object({
  phone: z.string().min(8).max(15),
});
export type AppointmentPhoneLookupQuery = z.infer<typeof appointmentPhoneLookupQuerySchema>;

export const appointmentPhoneLookupResponseSchema = z.object({
  suggestedFullName: z.string().nullable(),
  cancelledCount: z.number().int(),
});
export type AppointmentPhoneLookupResponse = z.infer<typeof appointmentPhoneLookupResponseSchema>;

/**
 * Ngưỡng cảnh báo spam (5 lần huỷ trở lên theo cùng SĐT, đã chốt với chủ dự án) — KHÔNG khai báo
 * hằng số ở đây. `apps/api` không dùng ngưỡng này (chỉ trả `cancelledCount` thô qua
 * `appointmentPhoneLookupResponseSchema` ở trên, không tự so sánh/chặn) — chỉ `apps/web` so sánh
 * để quyết định hiện banner cảnh báo, nên đặt tại `apps/web/src/features/appointment/
 * appointment-status.ts` (cùng khuôn `LATE_APPOINTMENT_THRESHOLD_MINUTES` ở file đó — ngưỡng hiển
 * thị thuần phía web). Cũng tránh một lỗi build thật gặp phải: Rollup (`vite build`) không dò được
 * named export là hằng số giá trị thuần (không phải Zod schema/type) từ gói CommonJS này qua
 * `__exportStar` — chưa rõ nguyên nhân sâu, nhưng mọi hằng số khác ở `packages/shared` hiện tại
 * đều chỉ dùng ở `apps/api` (chưa từng import vào `apps/web`) nên chưa từng lộ vấn đề này.
 */
