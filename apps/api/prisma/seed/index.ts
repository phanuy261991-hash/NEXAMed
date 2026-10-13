import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { seedPermissionCatalog } from '../../src/infrastructure/persistence/seed-permissions';
import { seedTenantDefaultCatalogs } from '../../src/infrastructure/persistence/seed-tenant-catalogs';
import { seedGeo } from '../../src/infrastructure/persistence/seed-geo';
import { seedIcd10Catalog } from '../../src/infrastructure/persistence/seed-icd10';

// Seed toàn cục — danh mục dùng chung `permission`/`province`/`ward`/`icd10_catalog`. Danh mục
// `reference_catalog` + dị nguyên RIÊNG THEO TENANT (docs/DECISIONS.md #230): bước dưới nạp bản mặc định
// cho MỌI tenant hiện có ("tạo nếu thiếu, không ghi đè"). Vai trò/ma trận cho từng tenant dùng
// seedDefaultRolesForTenant (src/infrastructure/persistence/seed-tenant-roles.ts) lúc tạo tenant.
//
// Chạy bằng role đặc quyền (MIGRATE_DATABASE_URL) vì `permission` đã REVOKE INSERT/UPDATE
// khỏi nexamed_app (xem prisma/migrations/*_rbac_data_scope).
const SYSTEM_ACTOR = '00000000-0000-0000-0000-000000000000';

async function main() {
  const url = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  try {
    await seedPermissionCatalog(prisma);
    console.log('✓ Seed permission catalog xong.');
    const tenants = await prisma.tenant.findMany({ where: { deletedAt: null }, select: { id: true } });
    for (const tenant of tenants) {
      await seedTenantDefaultCatalogs(prisma, tenant.id, SYSTEM_ACTOR);
    }
    console.log(`✓ Seed danh mục mặc định (reference catalog + dị nguyên) xong cho ${tenants.length} tenant.`);
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