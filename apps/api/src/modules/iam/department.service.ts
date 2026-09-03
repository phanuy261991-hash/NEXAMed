import { Injectable, NotFoundException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { ConcurrentModificationError } from '@nexamed/core';
import type {
  CreateDepartmentRequest,
  DepartmentSummary,
  ListDepartmentOptionsResponse,
  ListDepartmentsResponse,
  UpdateDepartmentRequest,
} from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import { BusinessCodeService } from '../clinic/business-code.service';
import type { RequestMeta } from '../../common/request-meta';
import { DepartmentRepository, type DepartmentWithType, type UpdateDepartmentData } from './department.repository';

/**
 * Khoa/Phòng (mở rộng ADM-01) — module `iam` sở hữu, cùng chỗ `role`/`user_account` (bảng phục vụ
 * Data Scope `department`, .claude/docs/architecture.md). Thêm/Sửa/Ẩn — cùng khuôn `RoomService`.
 * `code` tự sinh qua `BusinessCodeService` (docs/DECISIONS.md #114, loại mã `DEPARTMENT`, tiền tố
 * nội bộ "KP") — không nhập tay, theo yêu cầu chủ dự án 2026-08-20.
 */
@Injectable()
export class DepartmentService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly departmentRepository: DepartmentRepository,
    private readonly businessCodeService: BusinessCodeService,
  ) {}

  async createDepartment(
    tenantId: string,
    actorId: string,
    dto: CreateDepartmentRequest,
    meta: RequestMeta,
  ): Promise<DepartmentSummary> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const code = await this.businessCodeService.generate(tx, tenantId, actorId, 'DEPARTMENT', new Date());
      const created = await this.departmentRepository.create(
        tx,
        tenantId,
        actorId,
        dto.name,
        code,
        dto.departmentTypeId ?? null,
        dto.participatesInQueue ?? true,
      );

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'department.created',
        entityType: 'department',
        entityId: created.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      // findById kèm join tên loại (đúng khuôn RoomService.createRoom() gọi lại findById để lấy floorName).
      const withType = await this.departmentRepository.findById(tx, tenantId, created.id);
      return this.toSummary(withType!);
    });
  }

  async listDepartments(tenantId: string): Promise<ListDepartmentsResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const rows = await this.departmentRepository.list(tx, tenantId);
      return { items: rows.map((r) => this.toSummary(r)) };
    });
  }

  /** "Hàng đợi ảo" (#064) — chiếu tối thiểu, dùng chung nhiều nơi (không riêng điều phối Tiếp nhận, xem #107). */
  async listDepartmentOptions(tenantId: string, queueOnly: boolean): Promise<ListDepartmentOptionsResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const rows = await this.departmentRepository.listActiveOptions(tx, tenantId, queueOnly);
      return { items: rows };
    });
  }

  async updateDepartment(
    tenantId: string,
    actorId: string,
    id: string,
    dto: UpdateDepartmentRequest,
    meta: RequestMeta,
  ): Promise<DepartmentSummary> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.departmentRepository.findById(tx, tenantId, id);
      if (!existing) {
        throw new NotFoundException();
      }

      const patch: UpdateDepartmentData = {};
      if (dto.name !== undefined) patch.name = dto.name;
      if (dto.departmentTypeId !== undefined) patch.departmentTypeId = dto.departmentTypeId;
      if (dto.participatesInQueue !== undefined) patch.participatesInQueue = dto.participatesInQueue;
      if (dto.isActive !== undefined) patch.isActive = dto.isActive;

      const count = await this.departmentRepository.updateIfVersionMatches(tx, tenantId, id, dto.version, actorId, patch);
      if (count === 0) {
        throw new ConcurrentModificationError();
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'department.updated',
        entityType: 'department',
        entityId: id,
        afterJson: patch as Prisma.InputJsonObject,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const updated = await this.departmentRepository.findById(tx, tenantId, id);
      if (!updated) {
        throw new NotFoundException();
      }
      return this.toSummary(updated);
    });
  }

  private toSummary(department: DepartmentWithType): DepartmentSummary {
    return {
      id: department.id,
      code: department.code,
      name: department.name,
      departmentTypeId: department.departmentTypeId,
      departmentTypeName: department.departmentType?.name ?? null,
      participatesInQueue: department.participatesInQueue,
      isActive: department.isActive,
      version: department.version,
    };
  }
}