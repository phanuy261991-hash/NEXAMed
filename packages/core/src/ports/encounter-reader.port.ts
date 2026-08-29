/**
 * Đọc thông tin hiển thị tối thiểu của lượt khám theo id — dùng cho "Nhật ký hoạt động" (S5-05,
 * ADM-03) resolve mã lượt khám + bệnh nhân cho dòng `entityType='encounter'` (mọi thao tác lâm
 * sàng — sửa chẩn đoán/ghi chú khám/kê đơn/hoàn tất khám — đều ghi audit_log với entityType này).
 * Cùng tinh thần `PatientReaderPort`/`DoctorDirectoryPort`. Adapter thật
 * (`apps/api/src/modules/encounter/`) đọc trực tiếp `EncounterRepository`, đã lọc `tenant_id`.
 */
export interface EncounterReaderPort {
  findSummariesByIds(
    tenantId: string,
    encounterIds: string[],
  ): Promise<{ id: string; encounterNo: string; patientId: string }[]>;
  /** Toàn bộ id lượt khám thuộc một bệnh nhân — dùng để lọc audit_log theo bệnh nhân (entityType='encounter'). */
  findIdsByPatientId(tenantId: string, patientId: string): Promise<string[]>;
}

export const ENCOUNTER_READER_PORT = Symbol('ENCOUNTER_READER_PORT');
