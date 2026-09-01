import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

/**
 * Đổi mật khẩu role Postgres `nexamed_app` khỏi giá trị hard-code trong migration
 * (`20260807170922_tenant_context`, `docs/DECISIONS.md` #010) — bắt buộc chạy đúng một lần lúc
 * cài đặt on-prem (S4-05, `docs/Deploy.md` Phần 2), trước khi API khởi động lần đầu.
 *
 * Đọc mật khẩu mới từ NEXAMED_APP_DB_PASSWORD (do script cài đặt sinh ngẫu nhiên, ghi thẳng vào
 * `.env`). Chạy bằng role đặc quyền (MIGRATE_DATABASE_URL — role `nexamed`, chủ schema) vì role
 * `nexamed_app` không có quyền tự đổi mật khẩu chính mình (NOCREATEROLE).
 *
 * KHÔNG chạy lại tuỳ tiện sau lần cài đặt đầu — nếu chạy lại (ví dụ xoay vòng mật khẩu định kỳ)
 * thì phải cập nhật DATABASE_URL trong `.env` khớp giá trị mới NGAY LẬP TỨC rồi khởi động lại
 * service `api`, nếu không API sẽ không kết nối được DB nữa.
 *
 * Dùng: NEXAMED_APP_DB_PASSWORD="..." pnpm --filter @nexamed/api run db:rotate-app-password
 */
async function main() {
  const newPassword = process.env.NEXAMED_APP_DB_PASSWORD;
  if (!newPassword || newPassword.length < 16) {
    throw new Error('NEXAMED_APP_DB_PASSWORD phải có ít nhất 16 ký tự.');
  }

  const url = process.env.MIGRATE_DATABASE_URL;
  if (!url) {
    throw new Error('Thiếu MIGRATE_DATABASE_URL — cần role đặc quyền để đổi mật khẩu role khác.');
  }

  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    // Escape dấu nháy đơn — giá trị đến từ .env do chính script cài đặt sinh ra (không phải input
    // người dùng gõ trực tiếp), nhưng vẫn escape cho chắc vì $executeRawUnsafe không tự làm.
    const escaped = newPassword.replace(/'/g, "''");
    await prisma.$executeRawUnsafe(`ALTER ROLE nexamed_app WITH PASSWORD '${escaped}'`);
    console.log('✓ Đã đổi mật khẩu role nexamed_app. Xác nhận DATABASE_URL trong .env đã khớp giá trị mới.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('\n✗ Đổi mật khẩu role nexamed_app thất bại:', err instanceof Error ? err.message : err);
  process.exit(1);
});