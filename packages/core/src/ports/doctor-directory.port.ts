/**
 * Đọc danh sách bác sĩ đang active — dùng cho màn hình Lịch hẹn (S2-09, dựng cột theo bác sĩ).
 * Dữ liệu bác sĩ thuộc module `iam` (`user_account`/`user_role`/`role`); `appointment` không được
 * import thẳng service/repository của `iam` (.claude/docs/coding-standards.md mục "Ranh giới
 * module") nên khai báo port này, cùng mẫu `PatientReaderPort` được nêu làm ví dụ trong tài liệu
 * đó. Adapter thật (`apps/api/src/modules/iam/iam.module.ts`) đọc trực tiếp `user_account` — đã
 * lọc `tenant_id` theo RLS, không phải no-op.
 */
export interface DoctorDirectoryPort {
  listActiveDoctors(tenantId: string): Promise<{ id: string; fullName: string }[]>;
}

export const DOCTOR_DIRECTORY_PORT = Symbol('DOCTOR_DIRECTORY_PORT');
