import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { encryptPii } from '../src/infrastructure/crypto/pii-encryption';
import { generateTempPassword } from '../src/infrastructure/crypto/temp-password';
import { buildOtpAuthUri, generateTotpSecret } from '../src/infrastructure/crypto/totp';

/**
 * Tạo tài khoản NGƯỜI VẬN HÀNH nền tảng SaaS (docs/DECISIONS.md #237) — người duy nhất đăng nhập được khu quản trị (`admin.<tên miền gốc>`). Không thuộc công ty nào.
 * Chạy bằng role đặc quyền (MIGRATE_DATABASE_URL), cần `ENCRYPTION_KEY` (mã hoá bí mật OTP trong DB) — cùng khoá với API.
 *
 * Dùng: OPERATOR_USERNAME="..." OPERATOR_FULL_NAME="..." [OPERATOR_PASSWORD="..."] pnpm --filter @nexamed/api run db:seed:platform-operator
 * Không truyền OPERATOR_PASSWORD thì tự sinh mật khẩu và in ra ĐÚNG MỘT LẦN. Bí mật OTP + địa chỉ otpauth cũng chỉ in một lần: thêm vào ứng dụng xác thực (Google/Microsoft
 * Authenticator, Authy...) ngay. Mất cả hai thì chạy lại với tên đăng nhập khác (chưa có giao diện quản lý tài khoản vận hành).
 */
function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Thiếu biến môi trường bắt buộc: ${name}. Xem hướng dẫn ở đầu file script.`);
  return value;
}

async function main() {
  const username = requireEnv('OPERATOR_USERNAME');
  const fullName = requireEnv('OPERATOR_FULL_NAME');
  const encryptionKey = requireEnv('ENCRYPTION_KEY');
  const passwordInput = process.env.OPERATOR_PASSWORD?.trim();
  const generatedPassword = passwordInput ? null : generateTempPassword();
  const password = passwordInput ?? generatedPassword!;

  const prisma = new PrismaClient({ datasources: { db: { url: process.env.MIGRATE_DATABASE_URL ?? process.env.DATABASE_URL } } });
  try {
    if (await prisma.platformOperator.findUnique({ where: { username } })) {
      throw new Error(`Đã có người vận hành tên đăng nhập "${username}".`);
    }
    const secret = generateTotpSecret();
    await prisma.platformOperator.create({
      data: {
        username,
        fullName,
        passwordHash: await argon2.hash(password, { type: argon2.argon2id }),
        totpSecretEnc: encryptPii(secret, encryptionKey).toString('base64'),
      },
    });

    console.log('\n✓ Tạo người vận hành nền tảng xong.\n');
    console.log(`  Tên đăng nhập : ${username}`);
    console.log(generatedPassword ? `  Mật khẩu (tự sinh, CHỈ hiện một lần): ${generatedPassword}` : '  Mật khẩu      : (theo OPERATOR_PASSWORD đã truyền)');
    console.log(`  Bí mật OTP    : ${secret}   (CHỈ hiện một lần)`);
    console.log(`  otpauth       : ${buildOtpAuthUri(secret, username)}`);
    console.log('\nThêm bí mật OTP vào ứng dụng xác thực trên điện thoại rồi đăng nhập ở địa chỉ quản trị (admin.<tên miền gốc>).');
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('\n✗ Tạo người vận hành thất bại:', err instanceof Error ? err.message : err);
  process.exit(1);
});
