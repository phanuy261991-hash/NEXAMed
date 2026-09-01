import { z } from 'zod';
import { workShiftColorSchema } from './work-shift';

/**
 * "Đăng ký ca làm việc" — Giai đoạn 2 của danh mục "Ca làm việc" (`work-shift.ts`, #101). MỌI
 * nhân viên (không riêng bác sĩ) tự đăng ký ca cho một ngày cụ thể; quản lý (scope `global`) xem/
 * sửa/xoá toàn bộ. Xem plan lưu ở phiên dựng tính năng này (`docs/DECISIONS.md`).
 */
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const dateSchema = z.string().regex(DATE_PATTERN, 'Định dạng ngày phải là YYYY-MM-DD');
const MONTH_PATTERN = /^\d{4}-\d{2}$/;
const monthSchema = z.string().regex(MONTH_PATTERN, 'Định dạng tháng phải là YYYY-MM');

/** `userId` CHỈ có tác dụng với scope `global` (đăng ký/sửa hộ người khác) — scope `personal` luôn
 * bị ép về chính actor ở tầng Service, bỏ qua giá trị client gửi nếu có. */
export const createWorkShiftAssignmentRequestSchema = z.object({
  workShiftId: z.string().uuid(),
  workDate: dateSchema,
  userId: z.string().uuid().optional(),
});
export type CreateWorkShiftAssignmentRequest = z.infer<typeof createWorkShiftAssignmentRequestSchema>;

/** "Áp dụng cho các ngày đã chọn" (bulk-apply nhiều ngày cùng 1 ca) — bỏ qua (không lỗi) các ngày
 * đã có sẵn đúng ca này, trả về số lượng tạo/bỏ qua qua `bulkCreateWorkShiftAssignmentResponseSchema`. */
export const bulkCreateWorkShiftAssignmentRequestSchema = z.object({
  workShiftId: z.string().uuid(),
  workDates: z.array(dateSchema).min(1).max(62),
  userId: z.string().uuid().optional(),
});
export type BulkCreateWorkShiftAssignmentRequest = z.infer<typeof bulkCreateWorkShiftAssignmentRequestSchema>;

export const workShiftAssignmentBulkResultSchema = z.object({
  createdCount: z.number().int(),
  skippedCount: z.number().int(),
});
export type WorkShiftAssignmentBulkResult = z.infer<typeof workShiftAssignmentBulkResultSchema>;

/** "Sao chép tuần trước"/"Sao chép tháng trước" — CHỈ điền vào `(workDate, workShiftId)` còn TRỐNG
 * ở đích, bỏ qua ngày đích đã có sẵn (không ghi đè). Sao chép tháng ánh xạ theo SỐ NGÀY trong
 * tháng — tháng đích ít ngày hơn tháng nguồn (ví dụ 31→28) thì bỏ qua các ngày dư, không báo lỗi. */
export const copyWorkShiftAssignmentsRequestSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('week'),
    fromWeekStart: dateSchema,
    toWeekStart: dateSchema,
    userId: z.string().uuid().optional(),
  }),
  z.object({
    mode: z.literal('month'),
    fromMonth: monthSchema,
    toMonth: monthSchema,
    userId: z.string().uuid().optional(),
  }),
]);
export type CopyWorkShiftAssignmentsRequest = z.infer<typeof copyWorkShiftAssignmentsRequestSchema>;

/** DELETE có body (NestJS hỗ trợ, chấp nhận đánh đổi lệch REST thuần để giữ optimistic locking
 * đồng nhất mọi thao tác ghi trong hệ thống — cùng khuôn `cancelAppointmentRequestSchema`). */
export const deleteWorkShiftAssignmentRequestSchema = z.object({
  version: z.number().int().positive(),
});
export type DeleteWorkShiftAssignmentRequest = z.infer<typeof deleteWorkShiftAssignmentRequestSchema>;

export const workShiftAssignmentItemSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  workDate: z.string(),
  workShiftId: z.string().uuid(),
  workShiftName: z.string(),
  workShiftColor: workShiftColorSchema,
  startTime: z.string(),
  endTime: z.string(),
  /** Tự sửa/xoá được không — tính sẵn ở server (scope global: luôn `true`; scope personal: chỉ
   * `true` khi `createdAt` cùng ngày lịch VN với hiện tại) để FE không phải tự so ngày giờ. */
  canEdit: z.boolean(),
  version: z.number().int(),
});
export type WorkShiftAssignmentItem = z.infer<typeof workShiftAssignmentItemSchema>;

export const listWorkShiftAssignmentsQuerySchema = z.object({
  from: dateSchema,
  to: dateSchema,
  userId: z.string().uuid().optional(),
});
export type ListWorkShiftAssignmentsQuery = z.infer<typeof listWorkShiftAssignmentsQuerySchema>;

export const listWorkShiftAssignmentsResponseSchema = z.object({
  items: z.array(workShiftAssignmentItemSchema),
});
export type ListWorkShiftAssignmentsResponse = z.infer<typeof listWorkShiftAssignmentsResponseSchema>;

/**
 * `GET /appointments/doctor-work-shifts?date=` — chiếu tối thiểu TỰ-PHỤC VỤ cho lưới Lịch hẹn
 * (gắn quyền `appointment.read`, không phải `work_shift_assignment.read` — đúng khuôn `GET
 * /appointments/doctors`/`GET /departments/options`, #030/#064, tránh lỗ hổng "lễ tân không có
 * quyền đọc module khác" đã gặp 2 lần). Key = `doctorId`.
 */
export const doctorWorkShiftBlockSchema = z.object({
  name: z.string(),
  color: workShiftColorSchema,
  startTime: z.string(),
  endTime: z.string(),
});
export type DoctorWorkShiftBlock = z.infer<typeof doctorWorkShiftBlockSchema>;

export const doctorWorkShiftsForDateResponseSchema = z.object({
  byDoctorId: z.record(z.string().uuid(), z.array(doctorWorkShiftBlockSchema)),
});
export type DoctorWorkShiftsForDateResponse = z.infer<typeof doctorWorkShiftsForDateResponseSchema>;
