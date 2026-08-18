import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Role } from '@prisma/client';
import { ConcurrentModificationError, RoleDuplicateNameError, RoleImmutableError, RoleInUseError } from '@nexamed/core';
import type {
  CreateRoleRequest,
  HideRoleRequest,
  RenameRoleRequest,
  RolePermissionEntry,
  RoleSummary,
  RoleWithMatrixResponse,
  UpdateRolePermissionsRequest,
} from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import type { RequestMeta } from '../../common/request-meta';
import { RoleRepository } from './role.repository';
import { RolePermissionRepository } from './role-permission.repository';

function isNameConflict(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/**
 * Vai trò tuỳ biến + ma trận phân quyền (ADM-07, `docs/product/prd.md`) — module `iam` sở hữu
 * "tài khoản, vai trò" (.claude/docs/architecture.md). 5 vai trò hệ thống (`is_system_default`)
 * chỉ sửa được ma trận, không đổi tên/ẩn (`RoleImmutableError`) — tránh vỡ mọi nơi so khớp tên
 * vai trò cố định còn lại trong hệ thống (`DEFAULT_ROLE_PERMISSIONS`, `sync-role-permissions.ts`,
 * Sidebar.tsx phía web).
 */
@Injectable()
export class RoleService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly roleRepository: RoleRepository,
    private readonly rolePermissionRepository: RolePermissionRepository,
  ) {}

  async listRoles(tenantId: string): Promise<RoleSummary[]> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const roles = await this.roleRepository.list(tx, tenantId);
      return roles.map((r) => this.toSummary(r));
    });
  }

  async createRole(tenantId: string, actorId: string, dto: CreateRoleRequest, meta: RequestMeta): Promise<RoleSummary> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      let created: Role;
      try {
        created = await this.roleRepository.create(tx, tenantId, actorId, dto.name);
      } catch (err) {
        if (isNameConflict(err)) {
          throw new RoleDuplicateNameError();
        }
        throw err;
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'role.created',
        entityType: 'role',
        entityId: created.id,
        afterJson: { name: created.name },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      return this.toSummary(created);
    });
  }

  async renameRole(tenantId: string, actorId: string, id: string, dto: RenameRoleRequest, meta: RequestMeta): Promise<RoleSummary> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.roleRepository.findById(tx, tenantId, id);
      if (!existing) {
        throw new NotFoundException();
      }
      if (existing.isSystemDefault) {
        throw new RoleImmutableError();
      }

      let count: number;
      try {
        count = await this.roleRepository.renameIfVersionMatches(tx, tenantId, id, dto.version, actorId, dto.name);
      } catch (err) {
        if (isNameConflict(err)) {
          throw new RoleDuplicateNameError();
        }
        throw err;
      }
      if (count === 0) {
        throw new ConcurrentModificationError();
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'role.renamed',
        entityType: 'role',
        entityId: id,
        afterJson: { name: dto.name },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const updated = await this.roleRepository.findById(tx, tenantId, id);
      if (!updated) {
        throw new NotFoundException();
      }
      return this.toSummary(updated);
    });
  }

  async hideRole(tenantId: string, actorId: string, id: string, dto: HideRoleRequest, meta: RequestMeta): Promise<void> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const existing = await this.roleRepository.findById(tx, tenantId, id);
      if (!existing) {
        throw new NotFoundException();
      }
      if (existing.isSystemDefault) {
        throw new RoleImmutableError();
      }

      const activeAssignments = await this.roleRepository.countActiveAssignments(tx, tenantId, id);
      if (activeAssignments > 0) {
        throw new RoleInUseError();
      }

      const count = await this.roleRepository.hideIfVersionMatches(tx, tenantId, id, dto.version, actorId);
      if (count === 0) {
        throw new ConcurrentModificationError();
      }

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'role.hidden',
        entityType: 'role',
        entityId: id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });
  }

  async getRoleMatrix(tenantId: string, id: string): Promise<RoleWithMatrixResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const role = await this.roleRepository.findById(tx, tenantId, id);
      if (!role) {
        throw new NotFoundException();
      }

      const [catalog, granted] = await Promise.all([
        this.rolePermissionRepository.listCatalog(tx),
        this.rolePermissionRepository.listForRole(tx, tenantId, id),
      ]);
      const scopeByPermissionId = new Map(granted.map((rp) => [rp.permissionId, rp.dataScope]));

      const permissions: RolePermissionEntry[] = catalog.map((p) => ({
        permissionId: p.id,
        module: p.module,
        action: p.action,
        description: p.description,
        dataScope: scopeByPermissionId.get(p.id) ?? 'none',
      }));

      return { role: this.toSummary(role), permissions };
    });
  }

  async updateRoleMatrix(
    tenantId: string,
    actorId: string,
    id: string,
    dto: UpdateRolePermissionsRequest,
    meta: RequestMeta,
  ): Promise<RoleWithMatrixResponse> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const role = await this.roleRepository.findById(tx, tenantId, id);
      if (!role) {
        throw new NotFoundException();
      }

      await this.rolePermissionRepository.replaceMatrix(tx, tenantId, id, actorId, dto.entries);

      await writeAuditLog(tx, tenantId, {
        actorId,
        action: 'role_permission.updated',
        entityType: 'role',
        entityId: id,
        afterJson: { entries: dto.entries },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });

      const [catalog, granted] = await Promise.all([
        this.rolePermissionRepository.listCatalog(tx),
        this.rolePermissionRepository.listForRole(tx, tenantId, id),
      ]);
      const scopeByPermissionId = new Map(granted.map((rp) => [rp.permissionId, rp.dataScope]));
      const permissions: RolePermissionEntry[] = catalog.map((p) => ({
        permissionId: p.id,
        module: p.module,
        action: p.action,
        description: p.description,
        dataScope: scopeByPermissionId.get(p.id) ?? 'none',
      }));

      return { role: this.toSummary(role), permissions };
    });
  }

  private toSummary(role: Role): RoleSummary {
    return { id: role.id, name: role.name, isSystemDefault: role.isSystemDefault, version: role.version };
  }
}