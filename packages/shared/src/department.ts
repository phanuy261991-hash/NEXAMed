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
  isActive: z.boolean(),
  version: z.number().int(),
});
export type DepartmentSummary = z.infer<typeof departmentSummarySchema>;

export const listDepartmentsResponseSchema = z.object({
  items: z.array(departmentSummarySchema),
});
export type ListDepartmentsResponse = z.infer<typeof listDepartmentsResponseSchema>;

export const createDepartmentRequestSchema = z.object({
  name: z.string().min(1),
  departmentTypeId: z.string().uuid().optional(),
});
export type CreateDepartmentRequest = z.infer<typeof createDepartmentRequestSchema>;

export const updateDepartmentRequestSchema = z.object({
  name: z.string().min(1).optional(),
  departmentTypeId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
  version: z.number().int().positive(),
});
export type UpdateDepartmentRequest = z.infer<typeof updateDepartmentRequestSchema>;