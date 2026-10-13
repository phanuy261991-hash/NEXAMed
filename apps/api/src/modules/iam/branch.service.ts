import { Injectable, NotFoundException } from '@nestjs/common';
import type { Branch } from '@prisma/client';
import {
  BRANCH_CODE_PREFIX,
  BranchDefaultImmutableError,
  BranchDuplicateNameError,
  ConcurrentModificationError,
  formatShortSequentialCode,
} from '@nexamed/core';
import type { BranchSummary, CreateBranchRequest, ListBranchesResponse, UpdateBranchRequest } from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { CodeSequenceRepository } from '../../infrastructure/persistence/code-sequence.repository';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import type { RequestMeta } from '../../common/request-meta';
import { BranchRepository } from './branch.repository';

/**
 * Quản lý chi nhánh của công ty (docs/DECISIONS.md #231) — quyền `branch.read`/`branch.manage` (mặc định chỉ clinic_admin). Chi nhánh mặc định
 * không ngưng được; công ty luôn có ít nhất 1 chi nhánh.
 */
@Injectable()
export class BranchService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly branchRepository: BranchRepository,
    private readonly codeSequenceRepository: CodeSequenceRepository,
  ) {}

  async list(tenantId: string, includeInactive: boolean): Promise<ListBranchesResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const [rows, active] = await Promise.all([this.branchRepository.list(tx, tenantId, includeInactive), this.branchRepository.countActive(tx, tenantId)]);
      // Công ty ≤ 1 chi nhánh hoạt động: mọi tài khoản đang hoạt động đều thuộc chi nhánh đó (không cần dòng gán).
      const staff =
        active <= 1 ? null : await this.branchRepository.countStaffByBranch(tx, tenantId);
      const all = active <= 1 ? await this.branchRepository.countActiveUsers(tx, tenantId) : 0;
      return { items: rows.map((r) => this.toSummary(r, staff === null ? (r.isActive ? all : 0) : (staff.get(r.id) ?? 0))) };
    });
  }

  async create(tenantId: string, actorId: string, dto: CreateBranchRequest, meta: RequestMeta): Promise<BranchSummary> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      if (await this.branchRepository.existsActiveByName(tx, tenantId, dto.name)) {
        throw new BranchDuplicateNameError();
      }
      const activeBefore = await this.branchRepository.countActive(tx, tenantId);
      const seq = await this.codeSequenceRepository.next(tx, tenantId, BRANCH_CODE_PREFIX, actorId);
      const created = await this.branchRepository.create(tx, tenantId, actorId, {
        code: formatShortSequentialCode(BRANCH_CODE_PREFIX, seq),
        name: dto.name,
        address: dto.address ?? null,
        phone: dto.phone ?? null,
        isDefault: false,
      });
      if (activeBefore <= 1) await this.materializeAssignments(tx, tenantId, actorId);

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'branch.created',
        entityType: 'branch',
        entityId: created.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return this.toSummary(created, 0);
    });
  }

  async update(tenantId: string, actorId: string, id: string, dto: UpdateBranchRequest, meta: RequestMeta): Promise<BranchSummary> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.branchRepository.findById(tx, tenantId, id);
      if (!existing) throw new NotFoundException();
      if (dto.isActive === false && existing.isDefault) throw new BranchDefaultImmutableError();
      const willBeActive = dto.isActive ?? existing.isActive;
      if (dto.name !== undefined && willBeActive && (await this.branchRepository.existsActiveByName(tx, tenantId, dto.name, id))) {
        throw new BranchDuplicateNameError();
      }
      if (dto.isActive === true && !existing.isActive && (await this.branchRepository.existsActiveByName(tx, tenantId, dto.name ?? existing.name, id))) {
        throw new BranchDuplicateNameError();
      }

      const count = await this.branchRepository.update(tx, tenantId, id, dto.version, actorId, {
        name: dto.name,
        address: dto.address,
        phone: dto.phone,
        isActive: dto.isActive,
      });
      if (count === 0) throw new ConcurrentModificationError();
      if (dto.isActive === true && !existing.isActive) await this.materializeAssignments(tx, tenantId, actorId);

      const action =
        dto.isActive === false && existing.isActive ? 'branch.deactivated' : dto.isActive === true && !existing.isActive ? 'branch.reactivated' : 'branch.updated';
      await writeAuditLog(tx, tenantId, {
        actorId,
        action,
        entityType: 'branch',
        entityId: id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const updated = await this.branchRepository.findById(tx, tenantId, id);
      if (!updated) throw new NotFoundException();
      const staff = await this.branchRepository.countStaffByBranch(tx, tenantId);
      return this.toSummary(updated, staff.get(id) ?? 0);
    });
  }

  /** Công ty vừa có từ 2 chi nhánh hoạt động: tài khoản chưa có dòng gán nào được giữ lại ở chi nhánh mặc định. */
  private async materializeAssignments(tx: Parameters<BranchRepository['findDefault']>[0], tenantId: string, actorId: string): Promise<void> {
    const active = await this.branchRepository.countActive(tx, tenantId);
    if (active < 2) return;
    const defaultBranch = await this.branchRepository.findDefault(tx, tenantId);
    if (defaultBranch) await this.branchRepository.assignUnassignedUsersToBranch(tx, tenantId, actorId, defaultBranch.id);
  }

  private toSummary(row: Branch, staffCount: number): BranchSummary {
    return {
      id: row.id,
      code: row.code,
      name: row.name,
      address: row.address,
      isDefault: row.isDefault,
      phone: row.phone,
      isActive: row.isActive,
      staffCount,
      version: row.version,
    };
  }
}
