import { Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { BRANCH_DIRECTORY_PORT, ConcurrentModificationError, formatShortSequentialCode, type BranchDirectoryPort } from '@nexamed/core';
import type { CreateWarehouseRequest, ListWarehousesResponse, UpdateWarehouseRequest, WarehouseSummary } from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import { CodeSequenceRepository } from '../../infrastructure/persistence/code-sequence.repository';
import { resolveBranchScope } from '../../common/branch-context';
import type { RequestMeta } from '../../common/request-meta';
import { WarehouseRepository, type UpdateWarehouseData, type WarehouseWithDepartment } from './warehouse.repository';

/** Mã ngắn tuần tự (docs/DECISIONS.md #113/#146) — RIÊNG theo tenant, đúng khuôn `WorkShiftService`. */
const WAREHOUSE_CODE_PREFIX = 'KH';

/** Kho (Kho Thuốc & Vật tư y tế GĐ1, docs/DECISIONS.md #146) — module `drug`, dùng chung `drug.read`/
 * `drug.create`/`drug.update` (tách từ `drug.manage` gộp cũ, #156). Seed 1 kho mặc định lúc tạo
 * tenant (`ensureDefaultWarehouse`, đúng khuôn `floor`/`room` #054/#055) — web tự ẩn UI khi tenant
 * chỉ có 1 kho.
 *
 * Đợt 2 chi nhánh (#233): kho thuộc ĐÚNG MỘT chi nhánh. Đây là màn QUẢN TRỊ danh mục nên người có quyền được xem/sửa kho của MỌI chi nhánh
 * mình được gán (không chỉ chi nhánh đang làm); kho của chi nhánh không được gán → 404. Mọi nghiệp vụ kho khác (phiếu, tồn...) thì khoá cứng
 * theo chi nhánh đang làm — xem `WarehouseRepository.findById`. */
@Injectable()
export class WarehouseService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly warehouseRepository: WarehouseRepository,
    private readonly codeSequenceRepository: CodeSequenceRepository,
    @Inject(BRANCH_DIRECTORY_PORT) private readonly branchDirectory: BranchDirectoryPort,
  ) {}

  async createWarehouse(
    tenantId: string,
    actorId: string,
    currentBranchId: string,
    dto: CreateWarehouseRequest,
    meta: RequestMeta,
  ): Promise<WarehouseSummary> {
    const branchId = dto.branchId ?? currentBranchId;
    await this.assertBranchAssigned(tenantId, actorId, currentBranchId, branchId);

    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      if (dto.isDefault) {
        await this.warehouseRepository.clearDefaultExcept(tx, tenantId, branchId, null, actorId);
      }
      const seq = await this.codeSequenceRepository.next(tx, tenantId, WAREHOUSE_CODE_PREFIX, actorId);
      const code = formatShortSequentialCode(WAREHOUSE_CODE_PREFIX, seq);
      const created = await this.warehouseRepository.create(tx, tenantId, actorId, {
        code,
        name: dto.name,
        branchId,
        departmentId: dto.departmentId ?? null,
        isDefault: dto.isDefault ?? false,
      });

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'warehouse.created',
        entityType: 'warehouse',
        entityId: created.id,
        afterJson: { code, name: created.name, branchId, departmentId: created.departmentId, isDefault: created.isDefault },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const withDepartment = await this.warehouseRepository.findByIdAnyBranch(tx, tenantId, created.id);
      return this.toSummary(withDepartment!);
    });
  }

  async listWarehouses(tenantId: string, actorId: string, currentBranchId: string, allBranches: boolean): Promise<ListWarehousesResponse> {
    const branchIds = await resolveBranchScope(this.branchDirectory, tenantId, actorId, currentBranchId, allBranches);
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const rows = await this.warehouseRepository.list(tx, tenantId, branchIds);
      return { items: rows.map((r) => this.toSummary(r)) };
    });
  }

  async getWarehouse(tenantId: string, actorId: string, currentBranchId: string, id: string): Promise<WarehouseSummary> {
    const assigned = await this.assignedBranchIds(tenantId, actorId, currentBranchId);
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const row = await this.warehouseRepository.findByIdAnyBranch(tx, tenantId, id);
      if (!row || !assigned.has(row.branchId)) {
        throw new NotFoundException();
      }
      return this.toSummary(row);
    });
  }

  async updateWarehouse(
    tenantId: string,
    actorId: string,
    currentBranchId: string,
    id: string,
    dto: UpdateWarehouseRequest,
    meta: RequestMeta,
  ): Promise<WarehouseSummary> {
    const assigned = await this.assignedBranchIds(tenantId, actorId, currentBranchId);
    if (dto.branchId !== undefined && !assigned.has(dto.branchId)) {
      throw new NotFoundException();
    }

    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.warehouseRepository.findByIdAnyBranch(tx, tenantId, id);
      if (!existing || !assigned.has(existing.branchId)) {
        throw new NotFoundException();
      }

      const targetBranchId = dto.branchId ?? existing.branchId;
      const branchChanged = targetBranchId !== existing.branchId;
      if (branchChanged && (await this.warehouseRepository.hasActivity(tx, tenantId, id))) {
        throw new UnprocessableEntityException('Kho đã có phiếu hoặc tồn kho nên không đổi chi nhánh được. Muốn chuyển hàng sang chi nhánh khác, dùng điều chuyển kho.');
      }
      // Sau khi đổi chi nhánh, cờ "mặc định" tính theo chi nhánh MỚI: kho vừa chuyển đi không còn là mặc định ở nơi mới trừ khi được đặt lại.
      const willBeDefault = dto.isDefault ?? (branchChanged ? false : existing.isDefault);
      if (willBeDefault) {
        await this.warehouseRepository.clearDefaultExcept(tx, tenantId, targetBranchId, id, actorId);
      }

      const patch: UpdateWarehouseData = {};
      if (dto.name !== undefined) patch.name = dto.name;
      if (branchChanged) patch.branchId = targetBranchId;
      if (dto.departmentId !== undefined) patch.departmentId = dto.departmentId;
      if (dto.isDefault !== undefined || branchChanged) patch.isDefault = willBeDefault;
      if (dto.isActive !== undefined) patch.isActive = dto.isActive;

      const beforeJson: Record<string, Prisma.InputJsonValue | null> = {};
      const afterJson: Record<string, Prisma.InputJsonValue | null> = {};
      if (patch.name !== undefined && patch.name !== existing.name) { beforeJson.name = existing.name; afterJson.name = patch.name; }
      if (patch.branchId !== undefined) { beforeJson.branchId = existing.branchId; afterJson.branchId = patch.branchId; }
      if (patch.departmentId !== undefined && patch.departmentId !== existing.departmentId) { beforeJson.departmentId = existing.departmentId; afterJson.departmentId = patch.departmentId; }
      if (patch.isDefault !== undefined && patch.isDefault !== existing.isDefault) { beforeJson.isDefault = existing.isDefault; afterJson.isDefault = patch.isDefault; }
      if (patch.isActive !== undefined && patch.isActive !== existing.isActive) { beforeJson.isActive = existing.isActive; afterJson.isActive = patch.isActive; }

      const count = await this.warehouseRepository.updateIfVersionMatches(tx, tenantId, existing.branchId, id, dto.version, actorId, patch);
      if (count === 0) {
        throw new ConcurrentModificationError();
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'warehouse.updated',
        entityType: 'warehouse',
        entityId: id,
        beforeJson,
        afterJson,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const updated = await this.warehouseRepository.findByIdAnyBranch(tx, tenantId, id);
      if (!updated) {
        throw new NotFoundException();
      }
      return this.toSummary(updated);
    });
  }

  /** Chi nhánh tài khoản được gán + chi nhánh đang làm (luôn tính), dạng tập để tra nhanh. */
  private async assignedBranchIds(tenantId: string, actorId: string, currentBranchId: string): Promise<Set<string>> {
    const assigned = await this.branchDirectory.listAssignedBranchIds(tenantId, actorId);
    return new Set([currentBranchId, ...assigned]);
  }

  private async assertBranchAssigned(tenantId: string, actorId: string, currentBranchId: string, branchId: string): Promise<void> {
    if (branchId === currentBranchId) return;
    const assigned = await this.assignedBranchIds(tenantId, actorId, currentBranchId);
    if (!assigned.has(branchId)) {
      throw new NotFoundException();
    }
  }

  private toSummary(warehouse: WarehouseWithDepartment): WarehouseSummary {
    return {
      id: warehouse.id,
      code: warehouse.code,
      name: warehouse.name,
      branchId: warehouse.branchId,
      branchName: warehouse.branch.name,
      departmentId: warehouse.departmentId,
      departmentName: warehouse.department?.name ?? null,
      isDefault: warehouse.isDefault,
      isActive: warehouse.isActive,
      version: warehouse.version,
    };
  }
}
