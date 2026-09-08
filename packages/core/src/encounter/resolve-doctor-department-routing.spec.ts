import { describe, expect, it, vi } from 'vitest';
import { resolveDoctorDepartmentRouting } from './resolve-doctor-department-routing';
import type { DoctorDirectoryPort } from '../ports/doctor-directory.port';

function createFakeDoctorDirectory(overrides: Partial<DoctorDirectoryPort> = {}): DoctorDirectoryPort {
  return {
    listActiveDoctors: vi.fn().mockRejectedValue(new Error('không dùng trong test này')),
    getDoctorDepartmentId: vi.fn().mockResolvedValue(null),
    getDefaultDepartmentId: vi.fn().mockResolvedValue('default-dept'),
    getUserFullNames: vi.fn().mockRejectedValue(new Error('không dùng trong test này')),
    ...overrides,
  };
}

describe('resolveDoctorDepartmentRouting', () => {
  it('đích danh bác sĩ có Khoa sẵn — dùng đúng Khoa của bác sĩ đó', async () => {
    const directory = createFakeDoctorDirectory({ getDoctorDepartmentId: vi.fn().mockResolvedValue('dept-noi') });
    const result = await resolveDoctorDepartmentRouting(directory, 'tenant-1', { doctorId: 'doc-1' });
    expect(result).toEqual({ doctorId: 'doc-1', departmentId: 'dept-noi' });
  });

  it('đích danh bác sĩ CHƯA gán Khoa — fallback Khoa mặc định', async () => {
    const directory = createFakeDoctorDirectory({ getDoctorDepartmentId: vi.fn().mockResolvedValue(null) });
    const result = await resolveDoctorDepartmentRouting(directory, 'tenant-1', { doctorId: 'doc-1' });
    expect(result).toEqual({ doctorId: 'doc-1', departmentId: 'default-dept' });
  });

  it('theo Khoa, chưa rõ bác sĩ — doctorId null, giữ nguyên departmentId client gửi', async () => {
    const directory = createFakeDoctorDirectory();
    const result = await resolveDoctorDepartmentRouting(directory, 'tenant-1', { departmentId: 'dept-nhi' });
    expect(result).toEqual({ doctorId: null, departmentId: 'dept-nhi' });
    expect(directory.getDoctorDepartmentId).not.toHaveBeenCalled();
  });
});
