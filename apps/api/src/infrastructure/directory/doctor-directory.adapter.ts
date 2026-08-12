import { Injectable } from '@nestjs/common';
import type { DoctorDirectoryPort } from '@nexamed/core';
import { UnitOfWorkService } from '../persistence/unit-of-work.service';
import { UserAccountRepository } from '../../modules/iam/user-account.repository';

/**
 * Adapter thật (không no-op) cho `DoctorDirectoryPort` (S2-09) — đọc thẳng `user_account` qua
 * `UserAccountRepository` (đã có sẵn từ S2-07), tự mở transaction riêng qua `UnitOfWorkService`
 * (cùng mẫu `ClinicSettingsService.getSettings()`) vì port chỉ nhận `tenantId`, không có `tx` sẵn
 * từ caller.
 */
@Injectable()
export class DoctorDirectoryAdapter implements DoctorDirectoryPort {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly userAccountRepository: UserAccountRepository,
  ) {}

  async listActiveDoctors(tenantId: string): Promise<{ id: string; fullName: string }[]> {
    return this.unitOfWork.runInTenantScope(tenantId, (tx) => this.userAccountRepository.listActiveDoctors(tx, tenantId));
  }
}
