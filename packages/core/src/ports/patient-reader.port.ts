/**
 * Đọc thông tin hiển thị tối thiểu của bệnh nhân theo id — dùng cho "Nhật ký hoạt động" (S5-05,
 * ADM-03) resolve tên/mã hồ sơ cho dòng `entityType='patient'`, và cho `EncounterReaderPort`
 * (module `encounter`) tự resolve tiếp tên bệnh nhân của một lượt khám. Đây chính là port
 * `PatientReaderPort` từng được nêu làm ví dụ ở `.claude/docs/coding-standards.md` mục "Ranh giới
 * module" — lần đầu có consumer thật. Adapter thật (`apps/api/src/modules/patient/`) đọc trực tiếp
 * `PatientRepository`, đã lọc `tenant_id`. Id không tìm thấy (hồ sơ đã xoá/ngoài tenant) thì bỏ qua
 * thay vì lỗi — caller tự quyết định fallback hiển thị.
 */
export interface PatientReaderPort {
  findSummariesByIds(
    tenantId: string,
    patientIds: string[],
  ): Promise<{ id: string; fullName: string; patientCode: string }[]>;
}

export const PATIENT_READER_PORT = Symbol('PATIENT_READER_PORT');
