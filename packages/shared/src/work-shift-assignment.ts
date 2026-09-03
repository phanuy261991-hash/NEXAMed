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

/**
 * Nhập/Xuất Excel cho "Lịch làm việc nhân viên" (chỉ scope `global`/clinic_admin, đúng phạm vi đã
 * chốt — KHÔNG áp dụng cho "Lịch làm việc của tôi"). File dạng BẢNG NGANG: cột 1 = Mã nhân viên,
 * các cột còn lại = TỪNG NGÀY trong tháng (tiêu đề là số ngày 1..28/30/31, tối đa 31 cột), ô giao
 * = Mã ca (bỏ trống nếu không có ca hôm đó, nhiều ca/ngày ghi cách nhau bằng dấu phẩy).
 *
 * Ngày cụ thể suy từ VỊ TRÍ CỘT + tháng — bản thân file KHÔNG tự chứa tháng theo cách đọc được an
 * toàn (ô ghi chú tháng trong file mẫu chỉ để người dùng tự đối chiếu bằng mắt), nên `month` LUÔN
 * là tham số riêng do người dùng chọn tường minh ở UI lúc tải mẫu/nhập/xuất (mặc định = tháng đang
 * xem trên lưới) — không dò/suy đoán từ nội dung file.
 *
 * `POST .../import/preview` CHỈ đọc + đối chiếu, KHÔNG ghi gì — trả về 3 nhóm để người dùng tự xem
 * rồi quyết định có bấm "Xác nhận nhập" không (đã hỏi và chốt: không tự động bỏ qua/ghi đè trùng ca
 * âm thầm). `POST .../import/commit` gửi lại ĐÚNG file + `month` đó (FE giữ nguyên `File` trong
 * state) — chỉ tạo các ô hợp lệ VÀ CHƯA CÓ, ô lỗi/trùng luôn bị bỏ qua (không có "ghi đè" — trùng
 * nghĩa là (nhân viên, ngày, ca) đã giống hệt ô có sẵn, không có nội dung gì khác để ghi đè lên).
 */
export const workShiftAssignmentMonthSchema = z
  .string()
  .regex(/^\d{4}-\d{2}$/, 'Định dạng tháng phải là YYYY-MM');
export const importWorkShiftAssignmentRowErrorSchema = z.object({
  rowNumber: z.number().int(),
  employeeCode: z.string(),
  workDate: z.string(),
  workShiftCode: z.string(),
  reason: z.string(),
});
export type ImportWorkShiftAssignmentRowError = z.infer<typeof importWorkShiftAssignmentRowErrorSchema>;

export const importWorkShiftAssignmentValidRowSchema = z.object({
  rowNumber: z.number().int(),
  employeeName: z.string(),
  workDate: z.string(),
  workShiftName: z.string(),
});
export type ImportWorkShiftAssignmentValidRow = z.infer<typeof importWorkShiftAssignmentValidRowSchema>;

export const importWorkShiftAssignmentsPreviewResponseSchema = z.object({
  validRows: z.array(importWorkShiftAssignmentValidRowSchema),
  duplicateRows: z.array(importWorkShiftAssignmentValidRowSchema),
  errorRows: z.array(importWorkShiftAssignmentRowErrorSchema),
});
export type ImportWorkShiftAssignmentsPreviewResponse = z.infer<typeof importWorkShiftAssignmentsPreviewResponseSchema>;

export const importWorkShiftAssignmentsCommitResponseSchema = z.object({
  createdCount: z.number().int(),
  duplicateCount: z.number().int(),
  errorCount: z.number().int(),
});
export type ImportWorkShiftAssignmentsCommitResponse = z.infer<typeof importWorkShiftAssignmentsCommitResponseSchema>;

/**
 * `GET .../month-lock-status?month=` — chiếu tối thiểu TỰ-PHỤC VỤ ("Khoá bảng ca" theo tháng,
 * 2026-09-03), đúng khuôn `allowStaffSelfScheduleStatusSchema` (`clinic.ts`): MỌI nhân viên (không
 * chỉ `clinic_admin`) cần biết tháng đang xem có bị khoá hay không để "Lịch làm việc của tôi"/"Lịch
 * làm việc nhân viên" ẩn/hiện đúng nút, kể cả khi tháng đó CHƯA có ca nào (không suy ra được từ
 * `canEdit` của từng dòng item — có thể danh sách rỗng). `locked` là trạng thái TUYỆT ĐỐI của
 * tháng (không tính actor); `canBypass` là quyền `work_shift_assignment.unlock` CỦA ACTOR hiện tại
 * — cho phép FE phân biệt "khoá, bị chặn" (`locked && !canBypass`) với "khoá nhưng bạn mở khoá
 * được" (`locked && canBypass`).
 */
export const workShiftAssignmentMonthLockStatusQuerySchema = z.object({
  month: workShiftAssignmentMonthSchema,
});
export type WorkShiftAssignmentMonthLockStatusQuery = z.infer<typeof workShiftAssignmentMonthLockStatusQuerySchema>;

export const workShiftAssignmentMonthLockStatusResponseSchema = z.object({
  locked: z.boolean(),
  canBypass: z.boolean(),
});
export type WorkShiftAssignmentMonthLockStatusResponse = z.infer<typeof workShiftAssignmentMonthLockStatusResponseSchema>;
