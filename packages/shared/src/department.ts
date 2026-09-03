import { z } from 'zod';

/**
 * "Loại Khoa/Phòng" (mở rộng ADM-01, yêu cầu chủ dự án 2026-08-20) — cấp cha TÙY CHỌN của
 * `department`, THUẦN phân loại/tổ chức, đúng khuôn `floor` (cấp cha tùy chọn của `room`).
 */
export const departmentTypeSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  isActive: z.boolean(),
  version: z.number().int(),
});
export type DepartmentTypeSummary = z.infer<typeof departmentTypeSummarySchema>;

export const listDepartmentTypesResponseSchema = z.object({
  items: z.array(departmentTypeSummarySchema),
});
export type ListDepartmentTypesResponse = z.infer<typeof listDepartmentTypesResponseSchema>;

export const createDepartmentTypeRequestSchema = z.object({
  name: z.string().min(1),
});
export type CreateDepartmentTypeRequest = z.infer<typeof createDepartmentTypeRequestSchema>;

export const updateDepartmentTypeRequestSchema = z.object({
  name: z.string().min(1).optional(),
  isActive: z.boolean().optional(),
  version: z.number().int().positive(),
});
export type UpdateDepartmentTypeRequest = z.infer<typeof updateDepartmentTypeRequestSchema>;

/**
 * Khoa/Phòng (mở rộng ADM-01) — bảng `department` đã tồn tại từ S1-04b (phục vụ Data Scope), lần
 * đầu có module/API + trang quản lý riêng ("Danh mục Tổ chức và Nhân sự"). Thêm/Sửa/Ẩn — cùng
 * khuôn `room` (`isActive`, không soft-delete `deletedAt`, giữ nguyên lịch sử gán trên
 * `user_account.department_id` khi ẩn). `departmentTypeId` — cấp cha tùy chọn, xem
 * `departmentTypeSummarySchema` trên.
 */
export const departmentSummarySchema = z.object({
  id: z.string().uuid(),
  /** Mã hiển thị tự sinh (prefix "KP", đúng khuôn patient_code/employee_code) — `null` cho phòng ban tạo trước tính năng này. */
  code: z.string().nullable(),
  name: z.string(),
  departmentTypeId: z.string().uuid().nullable(),
  /** Kèm sẵn tên loại để hiển thị (cùng mẫu `RoomSummary.floorName`) — tránh N+1 lookup phía web. */
  departmentTypeName: z.string().nullable(),
  /** Có hiện trong `GET /departments/options` (điều phối Hàng đợi khám, #064) không — tách khỏi `departmentTypeId`, xem migration `20260903090000_department_participates_in_queue`. */
  participatesInQueue: z.boolean(),
  isActive: z.boolean(),
  version: z.number().int(),
});
export type DepartmentSummary = z.infer<typeof departmentSummarySchema>;

export const listDepartmentsResponseSchema = z.object({
  items: z.array(departmentSummarySchema),
});
export type ListDepartmentsResponse = z.infer<typeof listDepartmentsResponseSchema>;

/**
 * Chiếu tối thiểu tự-phục vụ (`GET /departments/options`), gắn quyền `reference_catalog.read`
 * thay vì `user_account.read` (như `GET /departments` ở trên) — đúng lý do đã áp dụng cho
 * `GET /appointments/doctors` (`docs/DECISIONS.md` #030): lễ tân/bác sĩ/điều dưỡng có
 * `reference_catalog.read` nhưng không có `user_account.read`. Chỉ Khoa đang `isActive`.
 */
export const departmentOptionSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
});
export type DepartmentOption = z.infer<typeof departmentOptionSchema>;

/**
 * `queueOnly` (#107, sửa lại #105) — TƯỜNG MINH do client gửi, mặc định `false` (trả TOÀN BỘ Khoa
 * đang active, đúng hành vi gốc trước #105 — dùng ở nhiều nơi ngoài điều phối hàng đợi, ví dụ
 * `MyAccountDialog.tsx` tự xem hồ sơ). `true` — CHỈ dùng ở khu vực điều phối "Hàng đợi khám" — lọc
 * thêm `participatesInQueue=true`, loại bộ phận hành chính (ví dụ "Bộ phận Lễ Tân").
 */
export const listDepartmentOptionsQuerySchema = z.object({
  queueOnly: z
    .union([z.boolean(), z.enum(['true', 'false'])])
    .optional()
    .default(false)
    .transform((v) => (typeof v === 'string' ? v === 'true' : v)),
});
export type ListDepartmentOptionsQuery = z.infer<typeof listDepartmentOptionsQuerySchema>;

export const listDepartmentOptionsResponseSchema = z.object({
  items: z.array(departmentOptionSchema),
});
export type ListDepartmentOptionsResponse = z.infer<typeof listDepartmentOptionsResponseSchema>;

export const createDepartmentRequestSchema = z.object({
  name: z.string().min(1),
  departmentTypeId: z.string().uuid().optional(),
  participatesInQueue: z.boolean().optional(),
});
export type CreateDepartmentRequest = z.infer<typeof createDepartmentRequestSchema>;

export const updateDepartmentRequestSchema = z.object({
  name: z.string().min(1).optional(),
  departmentTypeId: z.string().uuid().nullable().optional(),
  participatesInQueue: z.boolean().optional(),
  isActive: z.boolean().optional(),
  version: z.number().int().positive(),
});
export type UpdateDepartmentRequest = z.infer<typeof updateDepartmentRequestSchema>;