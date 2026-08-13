import { Injectable } from '@nestjs/common';
import type { Prisma, Tenant } from '@prisma/client';

export interface UpdateClinicProfileData {
  name?: string;
  phone?: string | null;
  address?: string | null;
  email?: string | null;
  currency?: string;
  taxCode?: string | null;
  timezone?: string;
  logoKey?: string;
  printLogoKey?: string;
}

/**
 * Chỗ DUY NHẤT gọi Prisma cho cột hồ sơ ("Thông tin phòng khám") của `tenant` — theo
 * .claude/docs/coding-standards.md. Bảng `tenant` không có `tenant_id`/RLS (chính nó là gốc,
 * xem docs/DECISIONS.md #011) nên lọc `id = tenantId` tường minh ở mọi query là lớp cách ly duy
 * nhất — không có RLS làm lớp phòng thủ thứ hai như các bảng khác.
 */
@Injectable()
export class ClinicProfileRepository {
  findByTenantId(tx: Prisma.TransactionClient, tenantId: string): Promise<Tenant | null> {
    return tx.tenant.findFirst({ where: { id: tenantId, deletedAt: null } });
  }

  /**
   * `updateMany` + kiểm `count` (không phải `update`) — cần ghép điều kiện `version = ?` trong
   * cùng `WHERE` cho optimistic locking, cùng mẫu `PatientRepository.updateIfVersionMatches`.
   */
  async updateIfVersionMatches(
    tx: Prisma.TransactionClient,
    tenantId: string,
    expectedVersion: number,
    actorId: string,
    data: UpdateClinicProfileData,
  ): Promise<number> {
    const result = await tx.tenant.updateMany({
      where: { id: tenantId, version: expectedVersion, deletedAt: null },
      data: { ...data, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }
}
