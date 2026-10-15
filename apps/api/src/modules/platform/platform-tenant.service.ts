import { Injectable } from '@nestjs/common';
import { Prisma, type Tenant } from '@prisma/client';
import * as argon2 from 'argon2';
import {
  ConcurrentModificationError,
  TenantAdminNotFoundError,
  TenantAlreadySuspendedError,
  TenantCodeInvalidError,
  TenantCodeTakenError,
  TenantNotFoundError,
  TenantNotSuspendedError,
  checkTenantCode,
} from '@nexamed/core';
import type {
  CreatePlatformTenantRequest,
  CreatePlatformTenantResponse,
  ListPlatformTenantsQuery,
  ListPlatformTenantsResponse,
  PlatformTenantDetail,
  PlatformTenantSummary,
  ResetTenantAdminPasswordResponse,
  SuspendPlatformTenantRequest,
  UnsuspendPlatformTenantRequest,
  UpdatePlatformTenantRequest,
} from '@nexamed/shared';
import type { RequestMeta } from '../../common/request-meta';
import { generateTempPassword } from '../../infrastructure/crypto/temp-password';
import { seedDefaultRolesForTenant } from '../../infrastructure/persistence/seed-tenant-roles';
import { seedTenantDefaultCatalogs } from '../../infrastructure/persistence/seed-tenant-catalogs';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { TenantHostService } from '../tenant-context/tenant-host.service';
import { PlatformAuditRepository } from './platform-audit.repository';
import { PlatformOperatorRepository } from './platform-operator.repository';
import { PlatformTenantRepository, type TenantUsageCounts } from './platform-tenant.repository';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
/** Gieo vai trò + danh mục mặc định cho công ty mới ghi vài trăm dòng — vượt hạn 5 giây mặc định của giao dịch. */
const CREATE_TENANT_TIMEOUT_MS = 120_000;
/** Số công ty đọc số đếm song song — mỗi công ty một giao dịch riêng có phạm vi RLS riêng. */
const USAGE_CONCURRENCY = 8;
const ADMIN_ROLE = 'clinic_admin';

/**
 * Quản trị công ty khách hàng ở khu nền tảng (docs/DECISIONS.md #237): danh sách, tạo (kèm tài khoản quản trị đầu tiên), sửa liên hệ, khoá/mở khoá, đặt lại mật khẩu quản trị.
 * KHÔNG đăng nhập thay vào công ty và KHÔNG đọc dữ liệu bệnh nhân — chỉ số đếm vận hành. Mọi thao tác ghi `platform_audit_log`.
 */
@Injectable()
export class PlatformTenantService {
  constructor(
    private readonly tenants: PlatformTenantRepository,
    private readonly operators: PlatformOperatorRepository,
    private readonly audit: PlatformAuditRepository,
    private readonly unitOfWork: UnitOfWorkService,
    private readonly hostService: TenantHostService,
  ) {}

  async list(query: ListPlatformTenantsQuery): Promise<ListPlatformTenantsResponse> {
    const [rows, stats] = await Promise.all([this.tenants.list({ q: query.q, status: query.status }), this.tenants.stats(new Date(Date.now() - THIRTY_DAYS_MS))]);
    const items: PlatformTenantSummary[] = [];
    for (let i = 0; i < rows.length; i += USAGE_CONCURRENCY) {
      const chunk = rows.slice(i, i + USAGE_CONCURRENCY);
      const counts = await Promise.all(chunk.map((t) => this.usageOf(t.id)));
      chunk.forEach((tenant, idx) => items.push(this.toSummary(tenant, counts[idx]!)));
    }
    return { items, stats: { total: stats.total, active: stats.total - stats.suspended, suspended: stats.suspended, createdLast30Days: stats.createdSince } };
  }

  async get(id: string): Promise<PlatformTenantDetail> {
    const tenant = await this.tenants.findById(id);
    if (!tenant) throw new TenantNotFoundError();
    return this.toDetail(tenant, await this.usageOf(id));
  }

  async create(dto: CreatePlatformTenantRequest, operatorId: string, meta: RequestMeta): Promise<CreatePlatformTenantResponse> {
    const code = dto.code.trim().toLowerCase();
    const check = checkTenantCode(code);
    if (check !== 'ok') throw new TenantCodeInvalidError(check);

    const tenantId = await this.tenants.nextId();
    const temporaryPassword = generateTempPassword();
    const passwordHash = await argon2.hash(temporaryPassword, { type: argon2.argon2id });

    try {
      // Mọi thứ trong MỘT giao dịch có phạm vi đúng công ty mới: lỗi giữa chừng thì không còn công ty dở dang.
      await this.unitOfWork.runInTenantScope(
        tenantId,
        async (tx) => {
          if (await this.tenants.codeExists(tx, code)) throw new TenantCodeTakenError();
          await this.tenants.insert(tx, {
            id: tenantId,
            name: dto.name,
            code,
            contactName: dto.contactName,
            contactPhone: dto.contactPhone,
            contactEmail: dto.contactEmail || null,
            operatorNote: dto.operatorNote || null,
            createdBy: operatorId,
            updatedBy: operatorId,
          });
          await seedDefaultRolesForTenant(tx, tenantId, operatorId);
          await seedTenantDefaultCatalogs(tx, tenantId, operatorId);
          const adminRole = await tx.role.findFirstOrThrow({ where: { tenantId, name: ADMIN_ROLE, deletedAt: null } });
          const admin = await tx.userAccount.create({
            data: {
              tenantId,
              username: dto.adminUsername,
              passwordHash,
              fullName: dto.adminFullName,
              mustChangePassword: true,
              createdBy: operatorId,
              updatedBy: operatorId,
            },
          });
          await tx.userRole.create({ data: { tenantId, userId: admin.id, roleId: adminRole.id, createdBy: operatorId, updatedBy: operatorId } });
        },
        { timeoutMs: CREATE_TENANT_TIMEOUT_MS },
      );
    } catch (error) {
      // Hai yêu cầu tạo cùng mã gần như đồng thời: ràng buộc UNIQUE của DB chặn một bên.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new TenantCodeTakenError();
      throw error;
    }

    this.hostService.invalidate();
    await this.audit.append({ operatorId, action: 'platform.tenant_created', targetTenantId: tenantId, ip: meta.ip, userAgent: meta.userAgent });
    return { tenant: await this.get(tenantId), adminUsername: dto.adminUsername, temporaryPassword };
  }

  async update(id: string, dto: UpdatePlatformTenantRequest, operatorId: string, meta: RequestMeta): Promise<PlatformTenantDetail> {
    const count = await this.unitOfWork.runInTenantScope(id, (tx) =>
      this.tenants.updateContact(tx, id, dto.version, { contactName: dto.contactName, contactPhone: dto.contactPhone, contactEmail: dto.contactEmail || null, operatorNote: dto.operatorNote || null }, operatorId),
    );
    if (count === 0) await this.throwMissingOrConcurrent(id);
    await this.audit.append({ operatorId, action: 'platform.tenant_updated', targetTenantId: id, ip: meta.ip, userAgent: meta.userAgent });
    return this.get(id);
  }

  async suspend(id: string, dto: SuspendPlatformTenantRequest, operatorId: string, meta: RequestMeta): Promise<PlatformTenantDetail> {
    const existing = await this.tenants.findById(id);
    if (!existing) throw new TenantNotFoundError();
    if (existing.suspendedAt) throw new TenantAlreadySuspendedError();
    await this.unitOfWork.runInTenantScope(id, async (tx) => {
      if ((await this.tenants.suspend(tx, id, dto.version, dto.reason, operatorId)) === 0) throw new ConcurrentModificationError();
      // "Đăng xuất ngay": thu hồi mọi phiên đang mở cùng giao dịch với việc khoá. Token truy cập đang cầm (tối đa 15 phút) bị chặn ở `TenantContextMiddleware`/`JwtAuthGuard` ngay khi đệm trạng thái được xoá.
      await this.tenants.revokeAllSessions(tx, id, 'tenant_suspended', operatorId);
    });
    this.hostService.invalidate();
    await this.audit.append({ operatorId, action: 'platform.tenant_suspended', targetTenantId: id, note: dto.reason, ip: meta.ip, userAgent: meta.userAgent });
    return this.get(id);
  }

  async unsuspend(id: string, dto: UnsuspendPlatformTenantRequest, operatorId: string, meta: RequestMeta): Promise<PlatformTenantDetail> {
    const existing = await this.tenants.findById(id);
    if (!existing) throw new TenantNotFoundError();
    if (!existing.suspendedAt) throw new TenantNotSuspendedError();
    await this.unitOfWork.runInTenantScope(id, async (tx) => {
      if ((await this.tenants.unsuspend(tx, id, dto.version, operatorId)) === 0) throw new ConcurrentModificationError();
    });
    this.hostService.invalidate();
    await this.audit.append({ operatorId, action: 'platform.tenant_unsuspended', targetTenantId: id, ip: meta.ip, userAgent: meta.userAgent });
    return this.get(id);
  }

  async resetAdminPassword(id: string, operatorId: string, meta: RequestMeta): Promise<ResetTenantAdminPasswordResponse> {
    const existing = await this.tenants.findById(id);
    if (!existing) throw new TenantNotFoundError();
    const temporaryPassword = generateTempPassword();
    const passwordHash = await argon2.hash(temporaryPassword, { type: argon2.argon2id });
    const admin = await this.unitOfWork.runInTenantScope(id, async (tx) => {
      const found = await this.tenants.findFirstActiveAdmin(tx, id);
      if (!found) throw new TenantAdminNotFoundError();
      await this.tenants.setPasswordAndUnlock(tx, id, found.id, passwordHash, operatorId);
      await this.tenants.revokeUserSessions(tx, id, found.id, 'password_reset', operatorId);
      return found;
    });
    await this.audit.append({ operatorId, action: 'platform.tenant_admin_password_reset', targetTenantId: id, ip: meta.ip, userAgent: meta.userAgent });
    return { adminUsername: admin.username, adminFullName: admin.fullName, temporaryPassword };
  }

  private usageOf(tenantId: string): Promise<TenantUsageCounts> {
    return this.unitOfWork.runInTenantScope(tenantId, (tx) => this.tenants.usageCounts(tx, tenantId));
  }

  private async throwMissingOrConcurrent(id: string): Promise<never> {
    if (!(await this.tenants.findById(id))) throw new TenantNotFoundError();
    throw new ConcurrentModificationError();
  }

  private toSummary(tenant: Tenant, counts: TenantUsageCounts): PlatformTenantSummary {
    return {
      id: tenant.id,
      name: tenant.name,
      code: tenant.code,
      loginUrl: tenant.code ? this.hostService.loginUrlFor(tenant.code) : null,
      status: tenant.suspendedAt ? 'suspended' : 'active',
      contactName: tenant.contactName,
      contactPhone: tenant.contactPhone,
      contactEmail: tenant.contactEmail,
      createdAt: tenant.createdAt.toISOString(),
      activeUserCount: counts.activeUserCount,
      branchCount: counts.branchCount,
      lastLoginAt: counts.lastLoginAt?.toISOString() ?? null,
    };
  }

  private async toDetail(tenant: Tenant, counts: TenantUsageCounts): Promise<PlatformTenantDetail> {
    const suspendedBy = tenant.suspendedBy ? await this.operators.findById(tenant.suspendedBy) : null;
    return {
      ...this.toSummary(tenant, counts),
      version: tenant.version,
      operatorNote: tenant.operatorNote,
      suspendedAt: tenant.suspendedAt?.toISOString() ?? null,
      suspendedReason: tenant.suspendedReason,
      suspendedByName: suspendedBy?.fullName ?? null,
    };
  }
}
