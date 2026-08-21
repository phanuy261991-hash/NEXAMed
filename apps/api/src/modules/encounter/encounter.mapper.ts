import type { Encounter } from '@prisma/client';
import type { EncounterSummary } from '@nexamed/shared';

/**
 * Hàm thuần dùng chung giữa `EncounterService` (transition) và `ReceptionService` (check-in) —
 * cả hai module đều trả `EncounterSummary` sau khi ghi. Đặt cạnh `EncounterRepository` trong
 * `modules/encounter/` (không phải trong `reception/`) vì đây là hình dạng dữ liệu của bảng
 * `encounter`, module `encounter` sở hữu bảng đó. Không cần đăng ký DI (hàm thuần, không phụ
 * thuộc gì) — import trực tiếp.
 */
export function toEncounterSummary(encounter: Encounter): EncounterSummary {
  return {
    id: encounter.id,
    encounterNo: encounter.encounterNo,
    patientId: encounter.patientId,
    doctorId: encounter.doctorId,
    departmentId: encounter.departmentId,
    appointmentId: encounter.appointmentId,
    status: encounter.status,
    specialty: encounter.specialty,
    checkedInAt: encounter.checkedInAt.toISOString(),
    startedAt: encounter.startedAt?.toISOString() ?? null,
    completedAt: encounter.completedAt?.toISOString() ?? null,
    chiefComplaint: encounter.chiefComplaint,
    version: encounter.version,
  };
}
