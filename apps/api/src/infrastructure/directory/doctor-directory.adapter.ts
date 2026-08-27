import { Injectable, InternalServerErrorException } from '@nestjs/common';
import type { DoctorDirectoryPort } from '@nexamed/core';
import { UnitOfWorkService } from '../persistence/unit-of-work.service';
import { UserAccountRepository } from '../../modules/iam/user-account.repository';
import { DepartmentRepository } from '../../modules/iam/department.repository';

/**
 * Adapter thật (không no-op) cho `DoctorDirectoryPort` (S2-09, mở rộng #064) — đọc thẳng
 * `user_account`/`department` qua repository của module `iam` (đã có sẵn), tự mở transaction
 * riêng qua `UnitOfWorkService` (cùng mẫu `ClinicSettingsService.getSettings()`) vì port chỉ nhận
 * `tenantId`, không có `tx` sẵn từ caller.
 */
@Injectable()
export class DoctorDirectoryAdapter implements DoctorDirectoryPort {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly userAccountRepository: UserAccountRepository,
    private readonly departmentRepository: DepartmentRepository,
  ) {}

  async listActiveDoctors(
    tenantId: string,
  ): Promise<{ id: string; fullName: string; displayName: string | null; departmentId: string | null }[]> {
    return this.unitOfWork.runInTenantScope(tenantId, (tx) => this.userAccountRepository.listActiveDoctors(tx, tenantId));
  }

  async getDoctorDepartmentId(tenantId: string, doctorId: string): Promise<string | null> {
    return this.unitOfWork.runInTenantScope(tenantId, (tx) => this.userAccountRepository.findDepartmentId(tx, tenantId, doctorId));
  }

  async getDefaultDepartmentId(tenantId: string): Promise<string> {
    const department = await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.departmentRepository.findDefault(tx, tenantId));
    // Mọi tenant đều được seed đúng 1 Khoa mặc định lúc tạo (`seedDefaultRolesForTenant`) — thiếu
    // dòng này là lỗi hạ tầng/seed, không phải tình huống nghiệp vụ hợp lệ cần DomainError riêng.
    if (!department) {
      throw new InternalServerErrorException('Tenant chưa có Khoa mặc định — kiểm tra lại bước seed tenant.');
    }
    return department.id;
  }

  async getUserFullNames(tenantId: string, userIds: string[]): Promise<Map<string, string>> {
    const uniqueIds = [...new Set(userIds)];
    const rows = await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.userAccountRepository.findFullNamesByIds(tx, tenantId, uniqueIds));
    return new Map(rows.map((r) => [r.id, r.fullName]));
  }
}
