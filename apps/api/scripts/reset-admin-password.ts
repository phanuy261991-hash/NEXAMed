import 'dotenv/config';
import { PrismaService } from '../src/infrastructure/persistence/prisma.service';
import { UnitOfWorkService } from '../src/infrastructure/persistence/unit-of-work.service';
import { ResetAdminPasswordError, resetAdminPassword } from '../src/infrastructure/persistence/reset-admin-password';

/**
 * Đặt lại mật khẩu một tài khoản khi QUÊN mật khẩu và không còn quản trị viên nào đăng nhập được (docs/Deploy.md mục 2.3, "Quên mật khẩu quản trị").
 * Chạy bằng role ứng dụng (DATABASE_URL) trong phạm vi một công ty — không dùng role đặc quyền. Tài khoản bị buộc đổi mật khẩu ở lần đăng nhập đầu, mọi phiên đang mở bị thu hồi.
 *
 * Trên máy khách (thư mục cài đặt, dịch vụ đã chạy):
 *   docker compose run --rm -e ADMIN_USERNAME=quantri migrate pnpm run db:reset-admin-password
 * Biến: ADMIN_USERNAME (bắt buộc), TENANT_ID (bắt buộc nếu có nhiều hơn một công ty), NEW_PASSWORD (tuỳ chọn, từ 12 ký tự; bỏ trống thì tự sinh và in ra ĐÚNG MỘT LẦN).
 */
async function main() {
  const username = process.env.ADMIN_USERNAME?.trim();
  if (!username) throw new ResetAdminPasswordError('Thiếu biến ADMIN_USERNAME (tên đăng nhập cần đặt lại mật khẩu). Xem hướng dẫn ở đầu file script.');
  const prisma = new PrismaService();
  await prisma.$connect();
  try {
    const result = await resetAdminPassword(prisma, new UnitOfWorkService(prisma), {
      username,
      tenantId: process.env.TENANT_ID?.trim() || undefined,
      newPassword: process.env.NEW_PASSWORD?.trim() || undefined,
    });
    console.log('\n✓ Đã đặt lại mật khẩu.\n');
    console.log(`  Phòng khám    : ${result.tenantName}`);
    console.log(`  Tài khoản     : ${result.username} (${result.fullName})`);
    console.log(result.generated ? `  Mật khẩu tạm  : ${result.password}   (CHỈ hiện một lần)` : '  Mật khẩu      : (theo NEW_PASSWORD đã truyền)');
    console.log('  Tài khoản bị buộc đổi mật khẩu ở lần đăng nhập đầu; mọi phiên đang mở đã bị thu hồi.');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('\n✗ Đặt lại mật khẩu thất bại:', err instanceof Error ? err.message : err);
  process.exit(1);
});
