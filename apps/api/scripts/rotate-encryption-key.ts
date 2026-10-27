import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../src/infrastructure/persistence/prisma.service';
import { RotateEncryptionKeyError, rotateEncryptionKey } from '../src/infrastructure/persistence/rotate-encryption-key';
import { keyFingerprint } from '../src/infrastructure/crypto/key-fingerprint';

/**
 * XOAY KHOÁ MÃ HOÁ hệ thống (docs/DECISIONS.md #262, docs/Deploy.md mục "Xoay khoá mã hoá"): mã hoá lại số CCCD, số thẻ BHYT, mật khẩu cổng liên thông... từ khoá cũ sang khoá mới trong MỘT giao dịch.
 * Chạy bằng role ứng dụng (DATABASE_URL), khi ứng dụng ĐÃ TẮT, SAU KHI đã sao lưu. Quy trình đầy đủ:
 *   1. docker compose exec backup /usr/local/bin/backup.sh        (sao lưu — hoặc dùng "Sao lưu ngay" trong ứng dụng)
 *   2. docker compose stop api web
 *   3. docker compose run --rm -e OLD_ENCRYPTION_KEY=<khoá hiện tại trong .env> -e NEW_ENCRYPTION_KEY=<khoá mới> migrate pnpm run db:rotate-encryption-key
 *      (thêm -e GENERATE_NEW_KEY=yes để hệ thống tự sinh khoá mới và in ra ĐÚNG MỘT LẦN; thêm -e DRY_RUN=yes để chỉ kiểm, không ghi gì)
 *   4. Sửa dòng ENCRYPTION_KEY= trong file .env thành khoá MỚI, lưu file khoá mới ở NƠI KHÁC máy chủ
 *   5. docker compose up -d
 * Biến: OLD_ENCRYPTION_KEY (bắt buộc), NEW_ENCRYPTION_KEY hoặc GENERATE_NEW_KEY=yes, DRY_RUN=yes (tuỳ chọn), ALLOW_UNREADABLE=yes (tuỳ chọn), CONFIRMED_BACKUP=yes (BẮT BUỘC khi ghi thật).
 */
async function main() {
  const oldKey = process.env.OLD_ENCRYPTION_KEY?.trim() ?? '';
  const dryRun = process.env.DRY_RUN === 'yes';
  const generate = process.env.GENERATE_NEW_KEY === 'yes';
  let newKey = process.env.NEW_ENCRYPTION_KEY?.trim() ?? '';
  if (!oldKey) throw new RotateEncryptionKeyError('Thiếu OLD_ENCRYPTION_KEY (đúng giá trị ENCRYPTION_KEY đang chạy). Xem hướng dẫn ở đầu file script.');
  if (generate && newKey) throw new RotateEncryptionKeyError('Chỉ dùng MỘT trong hai: NEW_ENCRYPTION_KEY hoặc GENERATE_NEW_KEY=yes.');
  if (generate) newKey = randomBytes(32).toString('hex');
  if (!newKey) throw new RotateEncryptionKeyError('Thiếu khoá mới: truyền NEW_ENCRYPTION_KEY hoặc GENERATE_NEW_KEY=yes.');
  if (!dryRun && process.env.CONFIRMED_BACKUP !== 'yes') {
    throw new RotateEncryptionKeyError('Xoay khoá thay đổi dữ liệu thật. Hãy sao lưu trước rồi chạy lại với CONFIRMED_BACKUP=yes (hoặc dùng DRY_RUN=yes để chỉ kiểm).');
  }

  const prisma = new PrismaService();
  await prisma.$connect();
  try {
    const report = await rotateEncryptionKey(prisma, { oldKey, newKey, dryRun, allowUnreadable: process.env.ALLOW_UNREADABLE === 'yes' });
    console.log(dryRun ? '\n✓ KIỂM XONG (chưa ghi gì).\n' : '\n✓ Đã xoay khoá.\n');
    console.log(`  Mã kiểm khoá cũ : ${report.oldFingerprint}`);
    console.log(`  Mã kiểm khoá mới: ${report.newFingerprint}`);
    console.log(`  Số công ty      : ${report.tenants}`);
    for (const [name, count] of Object.entries(report.rotated)) console.log(`  ${dryRun ? 'Sẽ mã hoá lại' : 'Đã mã hoá lại'} ${name}: ${count}`);
    for (const [name, count] of Object.entries(report.unreadable)) console.log(`  KHÔNG đọc được bằng khoá cũ (giữ nguyên) ${name}: ${count}`);
    if (!dryRun) {
      if (generate) console.log(`\n  KHOÁ MỚI (CHỈ hiện một lần, cất ở nơi khác máy chủ): ${newKey}`);
      console.log(`\n  BƯỚC TIẾP THEO: sửa ENCRYPTION_KEY= trong .env thành khoá mới (mã kiểm ${keyFingerprint(newKey)}), rồi docker compose up -d.`);
      console.log('  Nếu quên sửa .env, ứng dụng sẽ hiện cảnh báo "Khoá hệ thống không khớp" kèm hai mã kiểm khoá.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error('\n✗ Xoay khoá thất bại:', err instanceof Error ? err.message : err);
  process.exit(1);
});
