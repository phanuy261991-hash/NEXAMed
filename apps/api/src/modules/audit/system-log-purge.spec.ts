import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from '../../infrastructure/persistence/prisma.service';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { AuditLogRepository } from './audit-log.repository';
import { purgeSystemLogsForAllTenants } from './system-log-purge';

const SYSTEM_ACTOR = '00000000-0000-0000-0000-000000000000';

/**
 * Integration test thật trên Postgres cục bộ (cùng pattern `break-glass.spec.ts`) — xác nhận CẢ 2
 * điều kiện của chính sách lưu trữ 2 tầng (S5-05, chủ dự án chốt trực tiếp):
 * (1) role `nexamed_app` (kết nối `appPrisma` dưới đây, KHÔNG phải role đặc quyền) thật sự xoá được
 *     — xác nhận migration `20260829110000_audit_log_system_log_purge_grant` áp đúng;
 * (2) chỉ "System Log" quá hạn mới bị xoá — "Log nghiệp vụ" (gắn hồ sơ bệnh án) KHÔNG BAO GIỜ bị
 *     đụng tới dù cũ tới đâu, và System Log còn trong hạn cũng không bị xoá.
 */
describe('purgeSystemLogsForAllTenants — chính sách lưu trữ audit_log 2 tầng', () => {
  const privileged = new PrismaClient({ datasources: { db: { url: process.env.MIGRATE_DATABASE_URL } } });
  const appPrisma = new PrismaService();
  const unitOfWork = new UnitOfWorkService(appPrisma);
  const auditLogRepository = new AuditLogRepository();

  let tenantId: string;

  beforeAll(async () => {
    await privileged.$connect();
    await appPrisma.$connect();
    const tenant = await privileged.tenant.create({
      data: { name: `System log purge ${randomUUID()}`, createdBy: SYSTEM_ACTOR, updatedBy: SYSTEM_ACTOR },
    });
    tenantId = tenant.id;
  });

  afterAll(async () => {
    await privileged.auditLog.deleteMany({ where: { tenantId } });
    await privileged.tenant.delete({ where: { id: tenantId } });
    await privileged.$disconnect();
    await appPrisma.$disconnect();
  });

  function daysAgo(days: number): Date {
    return new Date(Date.now() - days * 24 * 60 * 60_000);
  }

  it('xoá System Log quá 90 ngày, giữ nguyên System Log còn hạn VÀ mọi Log nghiệp vụ dù cũ tới đâu', async () => {
    const [oldSystemLog, recentSystemLog, veryOldBusinessLog] = await Promise.all([
      privileged.auditLog.create({
        data: { tenantId, actorId: SYSTEM_ACTOR, action: 'user_account.created', entityType: 'user_account', entityId: randomUUID(), occurredAt: daysAgo(100) },
      }),
      privileged.auditLog.create({
        data: { tenantId, actorId: SYSTEM_ACTOR, action: 'user_account.updated', entityType: 'user_account', entityId: randomUUID(), occurredAt: daysAgo(10) },
      }),
      privileged.auditLog.create({
        data: { tenantId, actorId: SYSTEM_ACTOR, action: 'patient.updated', entityType: 'patient', entityId: randomUUID(), occurredAt: daysAgo(1000) },
      }),
    ]);

    const deletedCount = await purgeSystemLogsForAllTenants(appPrisma, unitOfWork, auditLogRepository);
    expect(deletedCount).toBeGreaterThanOrEqual(1);

    const remaining = await privileged.auditLog.findMany({ where: { tenantId }, select: { id: true } });
    const remainingIds = new Set(remaining.map((r) => r.id));

    expect(remainingIds.has(oldSystemLog.id)).toBe(false);
    expect(remainingIds.has(recentSystemLog.id)).toBe(true);
    expect(remainingIds.has(veryOldBusinessLog.id)).toBe(true);
  });
});
