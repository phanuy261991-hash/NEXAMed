import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { seedPermissionCatalog } from '../../src/infrastructure/persistence/seed-permissions';

// Seed toàn cục — chỉ danh mục `permission` (không có tenant_id). Seed vai trò/ma trận cho
// từng tenant cụ thể dùng seedDefaultRolesForTenant (src/infrastructure/persistence/
// seed-tenant-roles.ts) lúc tạo tenant.
//
// Chạy bằng role đặc quyền (MIGRATE_DATABASE_URL) vì `permission` đã REVOKE INSERT/UPDATE
// khỏi nexamed_app (xem prisma/migrations/*_rbac_data_scope).
async function main() {
  const url = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  try {
    await seedPermissionCatalog(prisma);
    console.log('✓ Seed permission catalog xong.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});