import { Injectable } from '@nestjs/common';
import type { Prisma, Tenant } from '@prisma/client';
import { PrismaService } from '../../infrastructure/persistence/prisma.service';

export interface TenantListFilter {
  q?: string;
  status: 'all' | 'active' | 'suspended';
}

export interface TenantUsageCounts {
  activeUserCount: number;
  branchCount: number;
  lastLoginAt: Date | null;
}

/**
 * Chỗ DUY NHẤT gọi Prisma cho phần quản trị công ty của khu nền tảng (docs/DECISIONS.md #237). Bảng `tenant` không có RLS nên đọc/ghi được ngoài phạm vi công ty;
 * các số đếm vận hành (tài khoản, chi nhánh, đăng nhập gần nhất) ĐỌC TRONG phạm vi công ty (`tx` của `runInTenantScope`) — không dùng role đặc quyền để quét chéo công ty.
 * Không bao giờ chạm bảng dữ liệu bệnh nhân.
 */
@Injectable()
export class PlatformTenantRepository {
  constructor(private readonly prisma: PrismaService) {}

  list(filter: TenantListFilter): Promise<Tenant[]> {
    const where: Prisma.TenantWhereInput = { deletedAt: null };
    if (filter.status === 'active') where.suspendedAt = null;
    if (filter.status === 'suspended') where.suspendedAt = { not: null };
    const q = filter.q?.trim();
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { code: { contains: q, mode: 'insensitive' } },
        { contactName: { contains: q, mode: 'insensitive' } },
      ];
    }
    return this.prisma.tenant.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
  }

  async stats(since: Date): Promise<{ total: number; suspended: number; createdSince: number }> {
    const base = { deletedAt: null } satisfies Prisma.TenantWhereInput;
    const [total, suspended, createdSince] = await Promise.all([
      this.prisma.tenant.count({ where: base }),
      this.prisma.tenant.count({ where: { ...base, suspendedAt: { not: null } } }),
      this.prisma.tenant.count({ where: { ...base, createdAt: { gte: since } } }),
    ]);
    return { total, suspended, createdSince };
  }

  findById(id: string): Promise<Tenant | null> {
    return this.prisma.tenant.findFirst({ where: { id, deletedAt: null } });
  }

  findByIds(ids: string[]): Promise<Tenant[]> {
    return this.prisma.tenant.findMany({ where: { id: { in: ids } } });
  }

  /** Sinh sẵn id (UUID v7 của DB) để tạo công ty VÀ gieo dữ liệu mặc định trong MỘT transaction có phạm vi đúng công ty mới. */
  async nextId(): Promise<string> {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`SELECT uuidv7()::text AS id`;
    return rows[0]!.id;
  }

  codeExists(tx: Prisma.TransactionClient, code: string): Promise<boolean> {
    return tx.tenant.count({ where: { code } }).then((n) => n > 0);
  }

  insert(tx: Prisma.TransactionClient, data: Prisma.TenantUncheckedCreateInput): Promise<Tenant> {
    return tx.tenant.create({ data });
  }

  /** Số đếm vận hành của MỘT công ty — gọi trong `runInTenantScope(tenantId)`. */
  async usageCounts(tx: Prisma.TransactionClient, tenantId: string): Promise<TenantUsageCounts> {
    const [activeUserCount, branchCount, lastSession] = await Promise.all([
      tx.userAccount.count({ where: { tenantId, isActive: true, deletedAt: null } }),
      tx.branch.count({ where: { tenantId, isActive: true, deletedAt: null } }),
      tx.userSession.aggregate({ where: { tenantId }, _max: { issuedAt: true } }),
    ]);
    return { activeUserCount, branchCount, lastLoginAt: lastSession._max.issuedAt };
  }

  async updateContact(
    tx: Prisma.TransactionClient,
    id: string,
    version: number,
    data: { contactName: string; contactPhone: string; contactEmail: string | null; operatorNote: string | null },
    operatorId: string,
  ): Promise<number> {
    const result = await tx.tenant.updateMany({
      where: { id, version, deletedAt: null },
      data: { ...data, updatedBy: operatorId, version: { increment: 1 } },
    });
    return result.count;
  }

  async suspend(tx: Prisma.TransactionClient, id: string, version: number, reason: string, operatorId: string): Promise<number> {
    const result = await tx.tenant.updateMany({
      where: { id, version, deletedAt: null, suspendedAt: null },
      data: { suspendedAt: new Date(), suspendedReason: reason, suspendedBy: operatorId, updatedBy: operatorId, version: { increment: 1 } },
    });
    return result.count;
  }

  async unsuspend(tx: Prisma.TransactionClient, id: string, version: number, operatorId: string): Promise<number> {
    const result = await tx.tenant.updateMany({
      where: { id, version, deletedAt: null, suspendedAt: { not: null } },
      data: { suspendedAt: null, suspendedReason: null, suspendedBy: null, updatedBy: operatorId, version: { increment: 1 } },
    });
    return result.count;
  }

  /** Thu hồi MỌI phiên đăng nhập đang mở của công ty (khoá công ty) — gọi trong `runInTenantScope(tenantId)`. */
  async revokeAllSessions(tx: Prisma.TransactionClient, tenantId: string, reason: string, operatorId: string): Promise<number> {
    const result = await tx.userSession.updateMany({
      where: { tenantId, deletedAt: null },
      data: { deletedAt: new Date(), deletedReason: reason, updatedBy: operatorId, version: { increment: 1 } },
    });
    return result.count;
  }

  async revokeUserSessions(tx: Prisma.TransactionClient, tenantId: string, userId: string, reason: string, operatorId: string): Promise<void> {
    await tx.userSession.updateMany({
      where: { tenantId, userId, deletedAt: null },
      data: { deletedAt: new Date(), deletedReason: reason, updatedBy: operatorId, version: { increment: 1 } },
    });
  }

  /** Tài khoản quản trị (vai trò `clinic_admin`) đang hoạt động ĐẦU TIÊN của công ty — đích của "Đặt lại mật khẩu quản trị". */
  findFirstActiveAdmin(tx: Prisma.TransactionClient, tenantId: string): Promise<{ id: string; username: string; fullName: string } | null> {
    return tx.userAccount.findFirst({
      where: { tenantId, isActive: true, deletedAt: null, userRoles: { some: { tenantId, deletedAt: null, role: { name: 'clinic_admin', deletedAt: null } } } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true, username: true, fullName: true },
    });
  }

  async setPasswordAndUnlock(tx: Prisma.TransactionClient, tenantId: string, userId: string, passwordHash: string, operatorId: string): Promise<void> {
    await tx.userAccount.update({
      where: { tenantId_id: { tenantId, id: userId } },
      data: { passwordHash, mustChangePassword: true, failedLoginCount: 0, lastFailedLoginAt: null, lockedUntil: null, updatedBy: operatorId, version: { increment: 1 } },
    });
  }
}
