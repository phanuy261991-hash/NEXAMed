import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';

export const SYSTEM_TEST_ACTOR = '00000000-0000-0000-0000-000000000000';

export interface TenantFixtureRef {
  id: string;
}

export interface TwoTenantFixture {
  tenantA: TenantFixtureRef;
  tenantB: TenantFixtureRef;
  cleanup(): Promise<void>;
}

/**
 * Helper dùng chung cho test cách ly tenant (S1-07) — tạo 2 tenant qua Prisma client đặc quyền
 * (thường là `new PrismaClient({ datasources: { db: { url: process.env.MIGRATE_DATABASE_URL } } })`,
 * bỏ qua RLS) và trả về hàm `cleanup()` xoá đúng phạm vi đã tạo theo đúng thứ tự FK. Thay cho
 * việc mỗi spec tự lặp lại boilerplate tạo/xoá tenant — đã thấy lặp lại ở `tenant-isolation.spec.ts`,
 * `rbac.spec.ts`, `auth.spec.ts`, `break-glass.spec.ts` (xem .claude/docs/coding-standards.md
 * mục Chống trùng lặp). Không retrofit 4 spec đó (đã pass, đã hiểu rõ pattern cũ) — dùng cho
 * test HTTP e2e và module nghiệp vụ mới từ S2 trở đi; xem cách dùng trong
 * `src/modules/iam/auth-login-http.spec.ts`.
 */
export async function createTwoTenantFixture(prisma: PrismaClient, namePrefix = 'Test'): Promise<TwoTenantFixture> {
  const tenantA = await prisma.tenant.create({
    data: { name: `${namePrefix} A ${randomUUID()}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
  });
  const tenantB = await prisma.tenant.create({
    data: { name: `${namePrefix} B ${randomUUID()}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
  });
  const tenantIds = [tenantA.id, tenantB.id];

  return {
    tenantA: { id: tenantA.id },
    tenantB: { id: tenantB.id },
    async cleanup() {
      // Thứ tự xoá theo FK: bảng con trước bảng cha. deleteMany trên bảng không có dòng nào
      // khớp là no-op an toàn — không cần biết trước caller có seed role/session hay không.
      await prisma.auditLog.deleteMany({ where: { tenantId: { in: tenantIds } } });
      // patient tự tham chiếu (merged_into_id) — bỏ tham chiếu trước khi xoá để không đụng FK
      // dù test S2-01 hiện chưa seed dữ liệu gộp hồ sơ (PAT-04 chưa hiện thực).
      await prisma.patient.updateMany({ where: { tenantId: { in: tenantIds } }, data: { mergedIntoId: null } });
      await prisma.patient.deleteMany({ where: { tenantId: { in: tenantIds } } });
      await prisma.codeSequence.deleteMany({ where: { tenantId: { in: tenantIds } } });
      await prisma.userSession.deleteMany({ where: { tenantId: { in: tenantIds } } });
      await prisma.rolePermission.deleteMany({ where: { tenantId: { in: tenantIds } } });
      await prisma.userRole.deleteMany({ where: { tenantId: { in: tenantIds } } });
      await prisma.role.deleteMany({ where: { tenantId: { in: tenantIds } } });
      await prisma.userAccount.deleteMany({ where: { tenantId: { in: tenantIds } } });
      await prisma.tenant.deleteMany({ where: { id: { in: tenantIds } } });
    },
  };
}
