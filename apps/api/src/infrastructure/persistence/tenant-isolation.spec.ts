import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { PrismaService } from './prisma.service';
import { UnitOfWorkService } from './unit-of-work.service';

// Integration test thật trên Postgres cục bộ (docker-compose), không mock Prisma — theo
// .claude/docs/coding-standards.md. Cần DATABASE_URL (role app) và MIGRATE_DATABASE_URL
// (role đặc quyền, để seed dữ liệu xuyên tenant mà không bị RLS chặn) đã set qua .env.
// S1-07 sẽ dựng lại test kiểu này trên testcontainers thành harness dùng chung cho toàn bộ
// endpoint — test này chỉ xác minh cơ chế RLS/UnitOfWork tự thân của S1-03.

const SYSTEM_ACTOR = '00000000-0000-0000-0000-000000000000';

describe('Row Level Security — cách ly tenant', () => {
  const privileged = new PrismaClient({
    datasources: { db: { url: process.env.MIGRATE_DATABASE_URL } },
  });
  const appPrisma = new PrismaService();
  const unitOfWork = new UnitOfWorkService(appPrisma);

  let tenantAId: string;
  let tenantBId: string;

  beforeAll(async () => {
    await privileged.$connect();
    await appPrisma.$connect();

    const tenantA = await privileged.tenant.create({
      data: { name: `Test A ${randomUUID()}`, createdBy: SYSTEM_ACTOR, updatedBy: SYSTEM_ACTOR },
    });
    const tenantB = await privileged.tenant.create({
      data: { name: `Test B ${randomUUID()}`, createdBy: SYSTEM_ACTOR, updatedBy: SYSTEM_ACTOR },
    });
    tenantAId = tenantA.id;
    tenantBId = tenantB.id;

    await privileged.userAccount.create({
      data: {
        tenantId: tenantAId,
        username: `user-a-${randomUUID()}`,
        passwordHash: 'x',
        fullName: 'User A',
        createdBy: SYSTEM_ACTOR,
        updatedBy: SYSTEM_ACTOR,
      },
    });
    await privileged.userAccount.create({
      data: {
        tenantId: tenantBId,
        username: `user-b-${randomUUID()}`,
        passwordHash: 'x',
        fullName: 'User B',
        createdBy: SYSTEM_ACTOR,
        updatedBy: SYSTEM_ACTOR,
      },
    });
  });

  afterAll(async () => {
    await privileged.userAccount.deleteMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } });
    await privileged.tenant.deleteMany({ where: { id: { in: [tenantAId, tenantBId] } } });
    await privileged.$disconnect();
    await appPrisma.$disconnect();
  });

  it('chỉ thấy user_account của đúng tenant đã set trong UnitOfWork', async () => {
    const rowsAsA = await unitOfWork.runInTenantScope(tenantAId, (tx) => tx.userAccount.findMany());
    expect(rowsAsA).toHaveLength(1);
    expect(rowsAsA[0]?.tenantId).toBe(tenantAId);

    const rowsAsB = await unitOfWork.runInTenantScope(tenantBId, (tx) => tx.userAccount.findMany());
    expect(rowsAsB).toHaveLength(1);
    expect(rowsAsB[0]?.tenantId).toBe(tenantBId);
  });

  it('không set tenant context thì không đọc được dữ liệu — fail closed bằng lỗi, không âm thầm trả rỗng', async () => {
    // Sau khi một connection từng SET LOCAL app.current_tenant_id trong transaction ở trên,
    // Postgres reset biến GUC tự định nghĩa này về '' (không phải NULL) khi transaction kết
    // thúc. current_setting(..., true)::uuid ép '' sang uuid sẽ lỗi — tức là quên set tenant
    // context sẽ ném lỗi rõ ràng thay vì âm thầm trả 0 dòng. Vẫn là fail closed (không rò dữ
    // liệu), chỉ khác là ồn ào hơn — dễ phát hiện bug hơn.
    await expect(
      appPrisma.userAccount.findMany({ where: { tenantId: { in: [tenantAId, tenantBId] } } }),
    ).rejects.toThrow();
  });

  it('role app không có quyền DELETE (thu hồi theo .claude/docs/data-model.md)', async () => {
    await expect(
      unitOfWork.runInTenantScope(tenantAId, (tx) =>
        tx.$executeRawUnsafe(`DELETE FROM user_account WHERE tenant_id = '${tenantAId}'`),
      ),
    ).rejects.toThrow();
  });

  it('không tự insert được dữ liệu cho tenant khác tenant đang set (WITH CHECK)', async () => {
    await expect(
      unitOfWork.runInTenantScope(tenantAId, (tx) =>
        tx.userAccount.create({
          data: {
            tenantId: tenantBId,
            username: `leak-${randomUUID()}`,
            passwordHash: 'x',
            fullName: 'Leak attempt',
            createdBy: SYSTEM_ACTOR,
            updatedBy: SYSTEM_ACTOR,
          },
        }),
      ),
    ).rejects.toThrow();
  });
});