import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { seedPermissionCatalog } from '../src/infrastructure/persistence/seed-permissions';
import { seedDefaultRolesForTenant } from '../src/infrastructure/persistence/seed-tenant-roles';

/**
 * Script CHỈ dùng cho máy dev — tạo một tenant + một tài khoản `clinic_admin` để đăng nhập thử
 * qua `apps/web` (chưa có màn hình "tạo phòng khám mới", đó là việc của module `clinic` ở S2).
 * Không dùng cho CI/production. Chạy bằng role đặc quyền (MIGRATE_DATABASE_URL) vì cần ghi
 * `permission` (đã revoke INSERT khỏi role app).
 *
 * Dùng: pnpm --filter @nexamed/api run db:seed:dev-tenant
 */
const SYSTEM_ACTOR = '00000000-0000-0000-0000-000000000000';
const DEV_USERNAME = 'dev.admin';
const DEV_PASSWORD = 'Dev@12345';

async function main() {
  const url = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  try {
    const tenant = await prisma.tenant.create({
      data: { name: `Phòng khám dev ${randomUUID().slice(0, 8)}`, createdBy: SYSTEM_ACTOR, updatedBy: SYSTEM_ACTOR },
    });

    const passwordHash = await argon2.hash(DEV_PASSWORD, { type: argon2.argon2id });
    const user = await prisma.userAccount.create({
      data: {
        tenantId: tenant.id,
        username: DEV_USERNAME,
        passwordHash,
        fullName: 'Quản trị viên (dev)',
        createdBy: SYSTEM_ACTOR,
        updatedBy: SYSTEM_ACTOR,
      },
    });

    await seedPermissionCatalog(prisma);
    await seedDefaultRolesForTenant(prisma, tenant.id, SYSTEM_ACTOR);
    const adminRole = await prisma.role.findFirstOrThrow({ where: { tenantId: tenant.id, name: 'clinic_admin' } });
    await prisma.userRole.create({
      data: {
        tenantId: tenant.id,
        userId: user.id,
        roleId: adminRole.id,
        createdBy: SYSTEM_ACTOR,
        updatedBy: SYSTEM_ACTOR,
      },
    });

    console.log('✓ Tạo tenant + tài khoản dev xong.\n');
    console.log(`  tenantId: ${tenant.id}`);
    console.log(`  username: ${DEV_USERNAME}`);
    console.log(`  password: ${DEV_PASSWORD}`);
    console.log('\nDán tenantId vào apps/web/public/config.json rồi chạy `pnpm dev`.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
