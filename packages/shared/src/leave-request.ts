import { z } from 'zod';

/**
 * "Đơn xin nghỉ" (#224) — nhân viên xin nghỉ MỘT NGÀY trên ca đã đăng ký (từng ca hoặc cả ngày),
 * người có quyền `leave_request.approve` duyệt/từ chối. Ca đã đăng ký giữ nguyên; nghỉ là bản ghi
 * riêng có lịch sử. Khung nghỉ tính bằng phút kể từ 00:00 giờ VN, khoảng nửa mở `[start, end)`.
 */
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Định dạng ngày phải là YYYY-MM-DD');
const reasonSchema = z.string().trim().min(1, 'Lý do là bắt buộc').max(500);
const versionSchema = z.number().int().positive();

export const leaveRequestStatusSchema = z.enum(['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'CANCELLED']);
export type LeaveRequestStatus = z.infer<typeof leaveRequestStatusSchema>;

/** `workShiftId = null` = nghỉ CẢ NGÀY (mọi ca đã đăng ký). */
export const createLeaveRequestRequestSchema = z.object({
  leaveDate: dateSchema,
  workShiftId: z.string().uuid().nullable(),
  reason: reasonSchema,
});
export type CreateLeaveRequestRequest = z.infer<typeof createLeaveRequestRequestSchema>;

/** Ghi nghỉ hộ — duyệt luôn, cần quyền `leave_request.file_on_behalf`. */
export const createLeaveRequestOnBehalfRequestSchema = createLeaveRequestRequestSchema.extend({
  userId: z.string().uuid(),
});
export type CreateLeaveRequestOnBehalfRequest = z.infer<typeof createLeaveRequestOnBehalfRequestSchema>;

export const approveLeaveRequestRequestSchema = z.object({ version: versionSchema });
export type ApproveLeaveRequestRequest = z.infer<typeof approveLeaveRequestRequestSchema>;

export const withdrawLeaveRequestRequestSchema = z.object({ version: versionSchema });
export type WithdrawLeaveRequestRequest = z.infer<typeof withdrawLeaveRequestRequestSchema>;

/** Từ chối đơn chờ duyệt. */
export const rejectLeaveRequestRequestSchema = z.object({ version: versionSchema, reason: reasonSchema });
export type RejectLeaveRequestRequest = z.infer<typeof rejectLeaveRequestRequestSchema>;

/** Huỷ đơn ĐÃ DUYỆT (bác sĩ đi làm lại) — khung đó mở lại bình thường. */
export const cancelLeaveRequestRequestSchema = z.object({ version: versionSchema, reason: reasonSchema });
export type CancelLeaveRequestRequest = z.infer<typeof cancelLeaveRequestRequestSchema>;

export const listLeaveRequestsQuerySchema = z.object({
  status: leaveRequestStatusSchema.optional(),
  from: dateSchema.optional(),
  to: dateSchema.optional(),
  /** Chỉ có tác dụng với scope `global`; scope `personal` luôn bị ép về chính actor. */
  userId: z.string().uuid().optional(),
});
export type ListLeaveRequestsQuery = z.infer<typeof listLeaveRequestsQuerySchema>;

export const leaveRequestItemSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  userFullName: z.string(),
  /** Khoa của nhân viên nếu xác định được (bác sĩ); không thì `null`. */
  departmentName: z.string().nullable(),
  leaveDate: z.string(),
  workShiftId: z.string().uuid().nullable(),
  /** Tên ca; `null` = cả ngày. */
  workShiftName: z.string().nullable(),
  startMinute: z.number().int(),
  endMinute: z.number().int(),
  isWholeDay: z.boolean(),
  status: leaveRequestStatusSchema,
  reason: z.string(),
  filedOnBehalf: z.boolean(),
  decidedByName: z.string().nullable(),
  decidedAt: z.string().nullable(),
  decisionReason: z.string().nullable(),
  createdAt: z.string(),
  /** Số lịch hẹn còn `SCHEDULED` trong khung nghỉ — chỉ tính cho người dùng có thể xem lịch hẹn (bác sĩ). */
  affectedAppointmentCount: z.number().int(),
  /** Actor là người gửi và đơn còn `PENDING` → rút được. */
  canWithdraw: z.boolean(),
  version: z.number().int(),
});
export type LeaveRequestItem = z.infer<typeof leaveRequestItemSchema>;

export const listLeaveRequestsResponseSchema = z.object({ items: z.array(leaveRequestItemSchema) });
export type ListLeaveRequestsResponse = z.infer<typeof listLeaveRequestsResponseSchema>;

/** `GET /leave-requests/pending-count` — chấm số "Lịch làm việc nhân viên" (người có quyền duyệt). */
export const leaveRequestPendingCountResponseSchema = z.object({ count: z.number().int() });
export type LeaveRequestPendingCountResponse = z.infer<typeof leaveRequestPendingCountResponseSchema>;

export const affectedAppointmentSchema = z.object({
  id: z.string().uuid(),
  bookingCode: z.string(),
  fullName: z.string(),
  phone: z.string(),
  scheduledAt: z.string(),
  durationMinutes: z.number().int(),
});
export type AffectedAppointmentItem = z.infer<typeof affectedAppointmentSchema>;

export const leaveRequestAffectedAppointmentsResponseSchema = z.object({ items: z.array(affectedAppointmentSchema) });
export type LeaveRequestAffectedAppointmentsResponse = z.infer<typeof leaveRequestAffectedAppointmentsResponseSchema>;

/**
 * `GET /leave-requests/my-impact?leaveDate=&workShiftId=` — dải cảnh báo ở hộp "Xin nghỉ": bác sĩ
 * đang có bao nhiêu lịch hẹn trong khung sắp xin nghỉ. Chỉ đọc, thuộc quyền `leave_request.create`.
 */
export const leaveRequestMyImpactQuerySchema = z.object({
  leaveDate: dateSchema,
  workShiftId: z.string().uuid().optional(),
});
export type LeaveRequestMyImpactQuery = z.infer<typeof leaveRequestMyImpactQuerySchema>;

export const leaveRequestMyImpactResponseSchema = z.object({ affectedAppointmentCount: z.number().int() });
export type LeaveRequestMyImpactResponse = z.infer<typeof leaveRequestMyImpactResponseSchema>;
