/**
 * Phân giải danh tính bệnh nhân xuyên tenant — xem .claude/docs/multi-tenancy.md điểm 6. v1
 * không dùng chung bệnh nhân giữa các tenant; mọi tra cứu bệnh nhân đi qua port này thay vì
 * query trực tiếp xuyên tenant, để khi bật master patient index (v3+) chỉ cần thay adapter.
 * Adapter v1 (`apps/api/src/infrastructure/patient-identity/same-tenant.adapter.ts`) trả chính
 * `patient.id` trong tenant hiện tại — khớp `patient.global_patient_ref` luôn null ở v1.
 */
export interface PatientIdentityPort {
  resolveGlobalRef(tenantId: string, patientId: string): Promise<string>;
}

export const PATIENT_IDENTITY_PORT = Symbol('PATIENT_IDENTITY_PORT');
