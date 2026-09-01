import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { seedPermissionCatalog } from '../src/infrastructure/persistence/seed-permissions';
import { seedDefaultRolesForTenant } from '../src/infrastructure/persistence/seed-tenant-roles';

/**
 * Tạo tenant + tài khoản `clinic_admin` ĐẦU TIÊN cho một phòng khám pilot thật (S4-06,
 * `docs/product/plan.md` mục 7) — bản production-safe của `seed-dev-tenant.ts` (script đó CHỈ
 * dùng cho máy dev, tên/mật khẩu hard-code, không dùng được cho pilot thật).
 *
 * Chạy bằng role đặc quyền (MIGRATE_DATABASE_URL) vì cần ghi `permission` (đã revoke INSERT khỏi
 * role app, xem docs/DECISIONS.md #010). Idempotent theo tenant: mỗi lần chạy tạo MỘT tenant mới
 * — không dùng để tạo thêm tài khoản cho tenant đã có (dùng UI "Danh mục quản lý tài khoản" sau
 * khi đăng nhập lần đầu).
 *
 * Dùng: TENANT_NAME="..." ADMIN_USERNAME="..." ADMIN_FULL_NAME="..." [ADMIN_PASSWORD="..."] \
 *   pnpm --filter @nexamed/api run db:seed:pilot-tenant
 * Không truyền ADMIN_PASSWORD thì script tự sinh mật khẩu mạnh và in ra ĐÚNG MỘT LẦN — không
 * lưu lại ở đâu khác, phải đổi ngay sau lần đăng nhập đầu (`mustChangePassword`, đã enforce sẵn
 * ở #063 qua RequireAuth.tsx).
 */
const SYSTEM_ACTOR = '00000000-0000-0000-0000-000000000000';

function generateStrongPassword(): string {
  // 18 ký tự base64url (không dấu, không khoảng trắng) — đủ mạnh cho mật khẩu tạo một lần rồi
  // buộc đổi ngay, không cần bộ ký tự đặc biệt phức tạp gây khó gõ/đọc qua điện thoại lúc cài đặt.
  return randomBytes(18).toString('base64url');
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Thiếu biến môi trường bắt buộc: ${name}. Xem hướng dẫn ở đầu file script.`);
  }
  return value;
}

async function main() {
  const tenantName = requireEnv('TENANT_NAME');
  const adminUsername = requireEnv('ADMIN_USERNAME');
  const adminFullName = requireEnv('ADMIN_FULL_NAME');
  const adminPasswordInput = process.env.ADMIN_PASSWORD?.trim();
  const generatedPassword = adminPasswordInput ? null : generateStrongPassword();
  const adminPassword = adminPasswordInput ?? generatedPassword!;

  const url = process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL;
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  try {
    const existing = await prisma.tenant.findFirst({ where: { name: tenantName, deletedAt: null } });
    if (existing) {
      throw new Error(
        `Đã tồn tại tenant tên "${tenantName}" (id ${existing.id}). Đổi TENANT_NAME nếu muốn tạo phòng khám mới, ` +
          `hoặc dùng UI "Danh mục quản lý tài khoản" để thêm tài khoản vào tenant có sẵn.`,
      );
    }

    const tenant = await prisma.tenant.create({
      data: { name: tenantName, createdBy: SYSTEM_ACTOR, updatedBy: SYSTEM_ACTOR },
    });

    const passwordHash = await argon2.hash(adminPassword, { type: argon2.argon2id });
    const user = await prisma.userAccount.create({
      data: {
        tenantId: tenant.id,
        username: adminUsername,
        passwordHash,
        fullName: adminFullName,
        mustChangePassword: true,
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

    console.log('\n✓ Tạo phòng khám (tenant) + tài khoản quản trị đầu tiên xong.\n');
    console.log(`  Tên phòng khám : ${tenantName}`);
    console.log(`  tenantId       : ${tenant.id}`);
    console.log(`  Tên đăng nhập  : ${adminUsername}`);
    if (generatedPassword) {
      console.log(`  Mật khẩu (tự sinh, CHỈ hiện đúng 1 lần): ${generatedPassword}`);
      console.log('  → Bắt buộc đổi mật khẩu ngay lần đăng nhập đầu tiên (hệ thống tự chặn tới khi đổi xong).');
    } else {
      console.log('  Mật khẩu       : (theo giá trị ADMIN_PASSWORD đã truyền)');
    }
    console.log(`\nDán "${tenant.id}" vào apps/web/public/config.json (khoá tenantId) rồi khởi động web.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('\n✗ Tạo tenant pilot thất bại:', err instanceof Error ? err.message : err);
  process.exit(1);
});