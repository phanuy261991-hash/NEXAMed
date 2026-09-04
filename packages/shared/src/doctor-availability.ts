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
