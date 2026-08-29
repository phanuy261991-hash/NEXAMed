import type { PrismaClient } from '@prisma/client';
import { SYSTEM_LOG_RETENTION_DAYS } from '@nexamed/core';
import type { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import type { AuditLogRepository } from './audit-log.repository';

/**
 * Xoá "System Log" quá `SYSTEM_LOG_RETENTION_DAYS` ngày cho MỌI tenant — cùng cấu trúc
 * `syncRolePermissionsForAllTenants()` (`apps/api/src/infrastructure/persistence/
 * sync-role-permissions.ts`): lặp qua từng tenant, mở transaction riêng qua `UnitOfWorkService` để
 * RLS (`app.current_tenant_id`) tự giới hạn đúng phạm vi. Hàm thuần (nhận dependency qua tham số)
 * để `SystemLogPurgeJob` (wrapper `@Cron`) gọi được, cùng tinh thần tách logic khỏi framework.
 */
export async function purgeSystemLogsForAllTenants(
  prisma: PrismaClient,
  unitOfWork: UnitOfWorkService,
  auditLogRepository: AuditLogRepository,
): Promise<number> {
  const tenants = await prisma.tenant.findMany({ where: { deletedAt: null }, select: { id: true } });
  const cutoff = new Date(Date.now() - SYSTEM_LOG_RETENTION_DAYS * 24 * 60 * 60_000);

  let totalDeleted = 0;
  for (const tenant of tenants) {
    const deleted = await unitOfWork.runInTenantScope(tenant.id, (tx) => auditLogRepository.purgeSystemLogsOlderThan(tx, cutoff));
    totalDeleted += deleted;
  }
  return totalDeleted;
}
