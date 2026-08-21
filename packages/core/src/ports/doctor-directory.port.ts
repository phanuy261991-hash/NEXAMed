/**
 * Đọc danh sách bác sĩ đang active — dùng cho màn hình Lịch hẹn (S2-09, dựng cột theo bác sĩ) và
 * khu vực Điều phối Bác sĩ/Khoa ở Tiếp nhận (#064). Dữ liệu bác sĩ thuộc module `iam`
 * (`user_account`/`user_role`/`role`/`department`); `appointment`/`reception`/`encounter` không
 * được import thẳng service/repository của `iam` (.claude/docs/coding-standards.md mục "Ranh giới
 * module") nên khai báo port này, cùng mẫu `PatientReaderPort` được nêu làm ví dụ trong tài liệu
 * đó. Adapter thật (`apps/api/src/infrastructure/directory/doctor-directory.adapter.ts`) đọc trực
 * tiếp `user_account`/`department` — đã lọc `tenant_id` theo RLS, không phải no-op.
 */
export interface DoctorDirectoryPort {
  listActiveDoctors(tenantId: string): Promise<{ id: string; fullName: string; departmentId: string | null }[]>;
  /**
   * "Hàng đợi ảo" (#064) — server tự suy `departmentId` từ hồ sơ bác sĩ khi Tiếp nhận/Check-in chọn
   * "đích danh bác sĩ", KHÔNG tin giá trị `departmentId` client tự gửi cho nhánh này (chỉ trường
   * hợp chọn "theo Khoa" mới nhận `departmentId` trực tiếp từ client). Trả `null` nếu `doctorId`
   * không tồn tại/không active — caller tự fallback `getDefaultDepartmentId()`.
   */
  getDoctorDepartmentId(tenantId: string, doctorId: string): Promise<string | null>;
  /** Khoa mặc định ("Khoa chung") — luôn tồn tại đúng 1 dòng/tenant, seed lúc tạo tenant (`seedDefaultRolesForTenant`). */
  getDefaultDepartmentId(tenantId: string): Promise<string>;
}

export const DOCTOR_DIRECTORY_PORT = Symbol('DOCTOR_DIRECTORY_PORT');
