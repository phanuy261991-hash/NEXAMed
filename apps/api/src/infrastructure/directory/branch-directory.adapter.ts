import { Injectable } from '@nestjs/common';
import type { BranchDirectoryPort } from '@nexamed/core';
import { UnitOfWorkService } from '../persistence/unit-of-work.service';
import { BranchRepository } from '../../modules/iam/branch.repository';
import { BranchAccessService } from '../../modules/iam/branch-access.service';

/**
 * Adapter thật cho `BranchDirectoryPort` (docs/DECISIONS.md #231) — đọc `branch`/`user_branch` qua repository/service của module `iam`, tự mở transaction
 * riêng (port chỉ nhận `tenantId`, cùng mẫu `DoctorDirectoryAdapter`). Đăng ký ở `IamModule` (global).
 */
@Injectable()
export class BranchDirectoryAdapter implements BranchDirectoryPort {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly branchRepository: BranchRepository,
    private readonly branchAccess: BranchAccessService,
  ) {}

  async getBranchNames(tenantId: string): Promise<Map<string, string>> {
    const rows = await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.branchRepository.list(tx, tenantId, true));
    return new Map(rows.map((b) => [b.id, b.name]));
  }

  async listAssignedBranchIds(tenantId: string, userId: string): Promise<string[]> {
    const rows = await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.branchAccess.resolveAssigned(tx, tenantId, userId));
    return rows.map((b) => b.id);
  }

  async isMultiBranch(tenantId: string): Promise<boolean> {
    return (await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.branchRepository.countActive(tx, tenantId))) > 1;
  }
}
