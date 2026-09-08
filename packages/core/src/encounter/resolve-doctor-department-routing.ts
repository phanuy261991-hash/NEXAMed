import type { DoctorDirectoryPort } from '../ports/doctor-directory.port';

export interface DoctorDepartmentRoutingInput {
  doctorId?: string;
  departmentId?: string;
}

export interface ResolvedDoctorDepartmentRouting {
  doctorId: string | null;
  departmentId: string;
}

/**
 * Điều phối Bác sĩ/Khoa ("Hàng đợi ảo", #064) — dùng chung giữa Tiếp nhận
 * (`ReceptionService.checkIn()`/`registerDirect()`) và "Đổi bác sĩ phụ trách"
 * (`EncounterService.reassignEncounter()`) — trích xuất khỏi `ReceptionService.resolveRouting()`
 * lúc có nơi dùng thứ hai (CLAUDE.md). Chọn "đích danh bác sĩ" (`routing.doctorId` có giá trị):
 * server TỰ SUY `departmentId` từ hồ sơ bác sĩ đó, KHÔNG tin `departmentId` client có thể gửi kèm
 * cho nhánh này (chặn client giả mạo gán sai Khoa) — fallback Khoa mặc định nếu bác sĩ chưa gán
 * Khoa nào. Chọn "theo Khoa, chưa rõ bác sĩ" (`routing.doctorId` vắng mặt): `doctorId=null`,
 * `departmentId` lấy thẳng từ client (Zod đã ép bắt buộc có `departmentId` trong trường hợp này).
 */
export async function resolveDoctorDepartmentRouting(
  doctorDirectory: DoctorDirectoryPort,
  tenantId: string,
  routing: DoctorDepartmentRoutingInput,
): Promise<ResolvedDoctorDepartmentRouting> {
  if (routing.doctorId) {
    const departmentId =
      (await doctorDirectory.getDoctorDepartmentId(tenantId, routing.doctorId)) ?? (await doctorDirectory.getDefaultDepartmentId(tenantId));
    return { doctorId: routing.doctorId, departmentId };
  }
  return { doctorId: null, departmentId: routing.departmentId! };
}
