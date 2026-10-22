import { Injectable } from '@nestjs/common';
import { Prisma, type Tenant } from '@prisma/client';
import * as argon2 from 'argon2';
import {
  ConcurrentModificationError,
  TenantAdminNotFoundError,
  TenantAlreadySuspendedError,
  TENANT_CODE_ALIAS_DAYS,
  TenantCodeInvalidError,
  TenantCodeReservedError,
  TenantCodeTakenError,
  TenantCodeUnchangedError,
  TenantNotFoundError,
  TenantNotSuspendedError,
  checkTenantCode,
} from '@nexamed/core';
import type {
  ChangePlatformTenantCodeRequest,
  ChangePlatformTenantCodeResponse,
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
          // Mã cũ của công ty vừa đổi mã đang được giữ chỗ (#245): không cấp cho công ty mới (tránh chiếm đúng tên cũ để dụ khách).
          const reservedUntil = await this.tenants.activeAliasUntil(tx, code, new Date());
          if (reservedUntil) throw new TenantCodeReservedError(reservedUntil);
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

  /**
   * Đổi MÃ công ty (tên miền phụ) theo quy trình có kiểm soát (docs/DECISIONS.md #245), vì khách có lúc cần đổi (đổi thương hiệu, gõ sai lúc tạo):
   * (1) mã mới phải hợp lệ, KHÁC mã hiện tại, chưa công ty nào dùng, và không đang bị giữ chỗ bởi lối tắt của công ty khác; (2) mã cũ giữ làm lối tắt chuyển hướng `TENANT_CODE_ALIAS_DAYS` ngày
   * (đường dẫn khách đã lưu vẫn dẫn tới đúng công ty) và KHÔNG cấp lại cho ai trong thời gian đó (tránh chiếm đúng tên cũ để dụ khách); (3) thu hồi MỌI phiên đăng nhập — phiên gắn với tên miền cũ,
   * nhân viên đăng nhập lại một lần ở địa chỉ mới; (4) ghi nhật ký vận hành kèm lý do. Tất cả trong MỘT giao dịch: lỗi giữa chừng thì không còn trạng thái dở dang.
   */
  async changeCode(id: string, dto: ChangePlatformTenantCodeRequest, operatorId: string, meta: RequestMeta): Promise<ChangePlatformTenantCodeResponse> {
    const newCode = dto.newCode.trim().toLowerCase();
    const check = checkTenantCode(newCode);
    if (check !== 'ok') throw new TenantCodeInvalidError(check);

    const existing = await this.tenants.findById(id);
    if (!existing) throw new TenantNotFoundError();
    // Công ty chưa có mã (dữ liệu cũ, chưa dùng SaaS) không đi qua đường đổi mã — mã đầu tiên đặt lúc tạo công ty.
    if (!existing.code) throw new TenantNotFoundError();
    const oldCode = existing.code;
    if (newCode === oldCode) throw new TenantCodeUnchangedError();

    const now = new Date();
    const expiresAt = new Date(now.getTime() + TENANT_CODE_ALIAS_DAYS * 24 * 60 * 60 * 1000);
    let revokedSessionCount = 0;
    try {
      revokedSessionCount = await this.unitOfWork.runInTenantScope(id, async (tx) => {
        if (await this.tenants.codeExists(tx, newCode)) throw new TenantCodeTakenError();
        const reservedUntil = await this.tenants.activeAliasUntil(tx, newCode, now);
        if (reservedUntil) throw new TenantCodeReservedError(reservedUntil);
        if ((await this.tenants.changeCode(tx, id, dto.version, oldCode, newCode, operatorId)) === 0) throw new ConcurrentModificationError();
        await this.tenants.addCodeAlias(tx, { tenantId: id, oldCode, newCode, reason: dto.reason, expiresAt, operatorId });
        return this.tenants.revokeAllSessions(tx, id, 'tenant_code_changed', operatorId);
      });
    } catch (error) {
      // Hai người vận hành đổi sang cùng một mã gần như đồng thời: ràng buộc UNIQUE của DB chặn một bên.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new TenantCodeTakenError();
      throw error;
    }

    this.hostService.invalidate();
    await this.audit.append({ operatorId, action: 'platform.tenant_code_changed', targetTenantId: id, note: `${oldCode} → ${newCode}: ${dto.reason}`, ip: meta.ip, userAgent: meta.userAgent });
    return { tenant: await this.get(id), oldCodeValidUntil: expiresAt.toISOString(), revokedSessionCount };
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
