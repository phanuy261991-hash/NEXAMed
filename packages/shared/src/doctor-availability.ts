import { z } from 'zod';

/**
 * "Tạm nghỉ / Đóng ca" — trạng thái sẵn sàng nhận bệnh của bác sĩ (tách biệt hoàn toàn khỏi
 * `encounter.status`, chỉ tác động routing/điều phối). `ACTIVE` (mặc định, không có dòng cho hôm
 * nay = ACTIVE ngầm định) → `BREAK` (tạm nghỉ, ca vẫn mở) → `ENDED` (đóng ca, bulk trả lượt khám
 * đang chờ về hàng chờ chung Khoa).
 */
export const doctorAvailabilityStatusSchema = z.enum(['ACTIVE', 'BREAK', 'ENDED']);
export type DoctorAvailabilityStatus = z.infer<typeof doctorAvailabilityStatusSchema>;

/**
 * `trigger='SCHEDULED_END'` — CHỈ dùng cho Trường hợp 2 ("Hết giờ làm việc", client tự phát hiện
 * qua polling so với giờ đóng cửa phòng khám) khi `status='ENDED'`, để service BỎ QUA kiểm tra
 * `ClinicSettings.allowEmergencyEndShift` (Trường hợp 2 luôn hoạt động, đã hỏi và chốt riêng với
 * chủ dự án — khác Trường hợp 1 "đóng đột xuất" bấm thủ công bất kỳ lúc nào).
 */
export const setDoctorAvailabilityRequestSchema = z.object({
  status: doctorAvailabilityStatusSchema,
  reason: z.string().max(500).optional(),
  trigger: z.literal('SCHEDULED_END').optional(),
});
export type SetDoctorAvailabilityRequest = z.infer<typeof setDoctorAvailabilityRequestSchema>;

export const doctorAvailabilitySchema = z.object({
  doctorId: z.string().uuid(),
  status: doctorAvailabilityStatusSchema,
  statusChangedAt: z.string(),
  reason: z.string().nullable(),
  releasedEncounterCount: z.number().int().nullable(),
});
export type DoctorAvailability = z.infer<typeof doctorAvailabilitySchema>;

/** Board điều phối lễ tân — CHỈ liệt kê bác sĩ có dòng hôm nay (BREAK/ENDED); bác sĩ không có
 * trong danh sách này = ACTIVE ngầm định (đúng pattern `doctor_room_session`). */
export const doctorAvailabilityBoardResponseSchema = z.object({
  items: z.array(doctorAvailabilitySchema),
});
export type DoctorAvailabilityBoardResponse = z.infer<typeof doctorAvailabilityBoardResponseSchema>;

/**
 * `GET /doctor-availability/policy` — chiếu tối thiểu TỰ-PHỤC VỤ (đúng khuôn
 * `deferredPaymentStatusSchema`/`GET /appointments/doctors`, #030): bác sĩ cần biết
 * `allowEmergencyEndShift` để quyết định hiện/ẩn nút "Đóng ca hôm nay" ở TopBar, lễ tân cần biết
 * `allowReceptionistEndShift` để hiện/ẩn nút "…" thao tác hộ — nhưng KHÔNG có `clinic_config.read`
 * (chỉ `clinic_admin`). Không dùng `GET /clinic-settings` đầy đủ (không lộ `businessHours` không
 * cần thiết).
 */
export const doctorAvailabilityPolicySchema = z.object({
  allowEmergencyEndShift: z.boolean(),
  allowReceptionistEndShift: z.boolean(),
});
export type DoctorAvailabilityPolicy = z.infer<typeof doctorAvailabilityPolicySchema>;

/**
 * `GET /doctor-availability/{doctorId}/shift-summary` — popup xác nhận "Đóng ca hôm nay" hiện tổng
 * hợp ca khám trong ngày (mockup duyệt trước khi code). Tính theo CẢ NGÀY hôm nay (không riêng
 * phiên ACTIVE hiện tại — Tạm nghỉ giữa ngày không làm mất số liệu trước đó, đã chốt qua hỏi-đáp).
 * `avgConsultMinutes=null` khi chưa có ca nào hoàn tất hôm nay (không phải `0`, tránh hiểu nhầm).
 * "Huỷ khám" chỉ tính ca ĐÃ GÁN cho đúng bác sĩ này (đã gọi khám) rồi mới huỷ — không tính ca còn ở
 * hàng chờ chung Khoa (chưa ai nhận) bị huỷ.
 */
export const doctorShiftSummarySchema = z.object({
  doctorId: z.string().uuid(),
  doctorName: z.string(),
  calledCount: z.number().int().nonnegative(),
  completedCount: z.number().int().nonnegative(),
  avgConsultMinutes: z.number().int().nonnegative().nullable(),
  cancelledCount: z.number().int().nonnegative(),
  prescriptionCount: z.number().int().nonnegative(),
});
export type DoctorShiftSummary = z.infer<typeof doctorShiftSummarySchema>;

/** Ngày lịch VN `YYYY-MM-DD`. */
const vietnamDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

/** `GET .../shift-summary?date=` — tổng hợp một NGÀY CŨ khi đóng ca bù; bỏ trống = hôm nay như trước. */
export const shiftSummaryQuerySchema = z.object({ date: vietnamDateSchema.optional() });
export type ShiftSummaryQuery = z.infer<typeof shiftSummaryQuerySchema>;

/**
 * Một ngày bác sĩ còn chưa đóng ca ("phiên trước chưa đóng", mockup duyệt 28/10/2026): ngày trước hôm nay mà bác sĩ
 * có nhận lượt khám, hoặc có ca đã xếp (không nghỉ phép cả ngày được duyệt), và chưa có bản ghi "Đã đóng ca".
 */
export const pendingClosureDaySchema = z.object({
  date: vietnamDateSchema,
  calledCount: z.number().int().nonnegative(),
  completedCount: z.number().int().nonnegative(),
  unprocessedCount: z.number().int().nonnegative(),
  /** Ca đã xếp của ngày đó (`HH:mm`); rỗng nếu ngày đó không có ca. */
  shifts: z.array(z.object({ startTime: z.string(), endTime: z.string() })),
});
export type PendingClosureDayDto = z.infer<typeof pendingClosureDaySchema>;

/**
 * `GET /doctor-availability/me/closing-state` — tự-phục vụ cho thanh đỉnh của bác sĩ: các ngày chưa đóng (chặn khám)
 * và GIỜ nhắc đóng ca hôm nay. `todayClosingTime` = giờ kết thúc của ca CUỐI đã xếp hôm nay (`HH:mm`); `null` kèm
 * `todayClosingSource=null` = không có ca nào → giao diện dùng giờ đóng cửa phòng khám; `todayClosingSource='LEAVE'` =
 * nghỉ phép cả ngày đã được duyệt → không nhắc; `todayClosingSource='DISABLED'` = phòng khám tắt "Nhắc và bắt buộc đóng ca" ở Cấu hình khám → không nhắc, không có ngày chặn.
 */
export const doctorClosingStateSchema = z.object({
  pendingDays: z.array(pendingClosureDaySchema),
  todayClosingTime: z.string().nullable(),
  todayClosingSource: z.enum(['SHIFT', 'LEAVE', 'DISABLED']).nullable(),
});
export type DoctorClosingState = z.infer<typeof doctorClosingStateSchema>;

/** `GET /doctor-availability/pending-closures` — dải nhắc của lễ tân: bác sĩ nào còn ngày chưa đóng ca. */
export const doctorPendingClosuresBoardSchema = z.object({
  items: z.array(z.object({ doctorId: z.string().uuid(), doctorName: z.string(), days: z.array(pendingClosureDaySchema) })),
});
export type DoctorPendingClosuresBoard = z.infer<typeof doctorPendingClosuresBoardSchema>;

/** `POST /doctor-availability/:doctorId/close-pending` — đóng TẤT CẢ ngày chưa đóng trong một lần xác nhận. */
export const closePendingRequestSchema = z.object({ reason: z.string().max(500).optional() });
export type ClosePendingRequest = z.infer<typeof closePendingRequestSchema>;

export const closePendingResponseSchema = z.object({
  closedDates: z.array(vietnamDateSchema),
  releasedEncounterCount: z.number().int().nonnegative(),
});
export type ClosePendingResponse = z.infer<typeof closePendingResponseSchema>;
