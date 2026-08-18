import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { seedPermissionCatalog } from '../../src/infrastructure/persistence/seed-permissions';
import { seedReferenceCatalog } from '../../src/infrastructure/persistence/seed-reference-catalog';
import { seedGeo } from '../../src/infrastructure/persistence/seed-geo';
import { seedIcd10Catalog } from '../../src/infrastructure/persistence/seed-icd10';

// Seed toàn cục — danh mục `permission` + `reference_catalog` (không có tenant_id). Seed vai
// trò/ma trận cho từng tenant cụ thể dùng seedDefaultRolesForTenant (src/infrastructure/
// persistence/seed-tenant-roles.ts) lúc tạo tenant.
//
// Chạy bằng role đặc quyền (MIGRATE_DATABASE_URL) vì `permission` đã REVOKE INSERT/UPDATE
// khỏi nexamed_app (xem prisma/migrations/*_rbac_data_scope). `reference_catalog` KHÔNG bị
// revoke (nexamed_app tự ghi được qua API, xem prisma/migrations/*_reference_catalog) nhưng
// vẫn seed qua role đặc quyền ở đây cho đơn giản (dùng chung 1 script/1 kết nối).
async function main() {
  const url = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  try {
    await seedPermissionCatalog(prisma);
    console.log('✓ Seed permission catalog xong.');
    await seedReferenceCatalog(prisma);
    console.log('✓ Seed reference catalog xong.');
    await seedGeo(prisma);
    console.log('✓ Seed province/ward xong.');
    await seedIcd10Catalog(prisma);
    console.log('✓ Seed icd10 catalog xong.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});