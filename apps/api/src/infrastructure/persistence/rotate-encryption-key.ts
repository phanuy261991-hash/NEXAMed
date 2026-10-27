import type { Prisma, PrismaClient } from '@prisma/client';
import { SYSTEM_ACTOR_ID } from '@nexamed/core';
import { keyFingerprint } from '../crypto/key-fingerprint';
import { insuranceCardHashInput } from '../crypto/lookup-hash-inputs';
import { encryptPii, hashForLookup, tryDecryptPii } from '../crypto/pii-encryption';
import { writeAuditLog } from './audit-log.helper';

/**
 * XOAY KHOÁ MÃ HOÁ (`db:rotate-encryption-key`, docs/DECISIONS.md #262): mã hoá lại MỌI dữ liệu đang mã hoá bằng khoá cũ sang khoá mới, đổi luôn mã băm tra trùng (băm dùng chính khoá) và mã kiểm khoá.
 * Chạy khi ứng dụng ĐÃ TẮT, bằng role ỨNG DỤNG (không dùng role đặc quyền) trong phạm vi RLS từng công ty, trong MỘT giao dịch duy nhất: lỗi giữa chừng thì không có gì thay đổi.
 *
 * Phạm vi (mọi nơi dùng `ENCRYPTION_KEY` để MÃ HOÁ/BĂM — liệt kê đủ để khoá cũ thật sự hết tác dụng):
 *  - `patient.national_id_enc` + `national_id_hash`; `insurance_card.card_no_enc` + `card_no_hash`; bản chụp thẻ trong `encounter.insurance_snapshot.cardNoEnc`;
 *  - mật khẩu/token cổng liên thông: `interop_facility_credential`, `interop_doctor_credential`, `interop_doctor_facility`;
 *  - bí mật OTP người vận hành nền tảng: `platform_operator.totp_secret_enc` (không thuộc công ty nào);
 *  - `idempotency_key` bị XOÁ (chỉ là phản hồi lưu tạm 24 giờ, mã hoá bằng khoá cũ);
 *  - `tenant_setting.encryption_key_fingerprint` ghi mã kiểm khoá MỚI.
 * Không đổi `version`/`updated_by` (dữ liệu thật không đổi, ứng dụng đang tắt nên không ai đang sửa). Link ảnh đã ký và phiên đăng nhập KHÔNG bị ảnh hưởng ngoài việc link ảnh cũ hết hiệu lực.
 *
 * AN TOÀN: bước kiểm TRƯỚC giải mã thử MỌI giá trị bằng khoá cũ; có giá trị không giải mã được → DỪNG, không ghi gì (trừ khi `allowUnreadable`, khi đó các giá trị đó được giữ nguyên, vẫn không đọc được).
 */
export class RotateEncryptionKeyError extends Error {}

export interface RotateEncryptionKeyOptions {
  oldKey: string;
  newKey: string;
  /** Chỉ kiểm và báo cáo, KHÔNG ghi gì. */
  dryRun?: boolean;
  /** Cho phép tiếp tục dù có giá trị không giải mã được bằng khoá cũ (giữ nguyên chúng). */
  allowUnreadable?: boolean;
  /** CHỈ dùng trong test: giới hạn danh sách công ty (CSDL test dùng chung giữa các spec chạy song song — xoay khoá mọi công ty sẽ đụng dữ liệu của spec khác). Có truyền thì KHÔNG đụng người vận hành nền tảng. Production không truyền. */
  tenantIds?: readonly string[];
}

export interface RotateEncryptionKeyReport {
  oldFingerprint: string;
  newFingerprint: string;
  dryRun: boolean;
  tenants: number;
  /** Số giá trị đã mã hoá lại (hoặc sẽ mã hoá lại nếu `dryRun`) theo từng loại. */
  rotated: Record<string, number>;
  /** Số giá trị KHÔNG giải mã được bằng khoá cũ theo từng loại (giữ nguyên). */
  unreadable: Record<string, number>;
}

const MIN_KEY_LENGTH = 32;
const BATCH = 500;

type Counter = Record<string, number>;
const bump = (counter: Counter, name: string, by = 1) => {
  counter[name] = (counter[name] ?? 0) + by;
};

interface Context {
  tx: Prisma.TransactionClient;
  tenantId: string;
  oldKey: string;
  newKey: string;
  write: boolean;
  rotated: Counter;
  unreadable: Counter;
}

/** Giải mã bằng khoá cũ; được thì đếm "sẽ mã hoá lại" và trả plaintext, không được thì đếm "không đọc được" và trả `null`. */
function reencryptValue(ctx: Context, name: string, payload: Buffer | Uint8Array | null | undefined): { plain: string; encrypted: Buffer } | null {
  if (!payload) return null;
  const plain = tryDecryptPii(Buffer.from(payload), ctx.oldKey);
  if (plain === null) {
    bump(ctx.unreadable, name);
    return null;
  }
  bump(ctx.rotated, name);
  return { plain, encrypted: encryptPii(plain, ctx.newKey) };
}

async function rotateTenant(ctx: Context): Promise<void> {
  const { tx, tenantId } = ctx;

  // ---- patient (CCCD)
  for (let cursor: string | undefined; ; ) {
    const rows = await tx.patient.findMany({ where: { tenantId, nationalIdEnc: { not: null } }, select: { id: true, nationalIdEnc: true }, orderBy: { id: 'asc' }, take: BATCH, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    if (rows.length === 0) break;
    for (const row of rows) {
      const next = reencryptValue(ctx, 'patient.national_id', row.nationalIdEnc);
      if (next && ctx.write) await tx.patient.update({ where: { id: row.id }, data: { nationalIdEnc: next.encrypted, nationalIdHash: hashForLookup(next.plain, ctx.newKey) } });
    }
    cursor = rows[rows.length - 1]!.id;
  }

  // ---- insurance_card (số thẻ BHYT)
  for (let cursor: string | undefined; ; ) {
    const rows = await tx.insuranceCard.findMany({ where: { tenantId }, select: { id: true, cardNoEnc: true }, orderBy: { id: 'asc' }, take: BATCH, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    if (rows.length === 0) break;
    for (const row of rows) {
      const next = reencryptValue(ctx, 'insurance_card.card_no', row.cardNoEnc);
      if (next && ctx.write) await tx.insuranceCard.update({ where: { id: row.id }, data: { cardNoEnc: next.encrypted, cardNoHash: hashForLookup(insuranceCardHashInput(next.plain), ctx.newKey) } });
    }
    cursor = rows[rows.length - 1]!.id;
  }

  // ---- bản chụp thẻ BHYT trong lượt khám (JSON, số thẻ mã hoá base64)
  const snapshotIds = await tx.$queryRaw<Array<{ id: string }>>`SELECT id FROM encounter WHERE tenant_id = ${tenantId}::uuid AND insurance_snapshot ? 'cardNoEnc' ORDER BY id`;
  for (const { id } of snapshotIds) {
    const encounter = await tx.encounter.findFirst({ where: { id, tenantId }, select: { insuranceSnapshot: true } });
    const snapshot = (encounter?.insuranceSnapshot ?? null) as { cardNoEnc?: unknown } | null;
    if (!snapshot || typeof snapshot.cardNoEnc !== 'string') continue;
    const next = reencryptValue(ctx, 'encounter.insurance_snapshot', Buffer.from(snapshot.cardNoEnc, 'base64'));
    if (next && ctx.write) await tx.encounter.update({ where: { id }, data: { insuranceSnapshot: { ...snapshot, cardNoEnc: next.encrypted.toString('base64') } as Prisma.InputJsonValue } });
  }

  // ---- cổng liên thông đơn thuốc
  for (const row of await tx.interopFacilityCredential.findMany({ where: { tenantId }, select: { id: true, passwordEnc: true, tokenEnc: true } })) {
    const password = reencryptValue(ctx, 'interop_facility_credential.password', row.passwordEnc);
    const token = reencryptValue(ctx, 'interop_facility_credential.token', row.tokenEnc);
    if (ctx.write && (password || token)) await tx.interopFacilityCredential.update({ where: { id: row.id }, data: { ...(password ? { passwordEnc: password.encrypted } : {}), ...(token ? { tokenEnc: token.encrypted } : {}) } });
  }
  for (const row of await tx.interopDoctorCredential.findMany({ where: { tenantId }, select: { id: true, passwordEnc: true } })) {
    const password = reencryptValue(ctx, 'interop_doctor_credential.password', row.passwordEnc);
    if (ctx.write && password) await tx.interopDoctorCredential.update({ where: { id: row.id }, data: { passwordEnc: password.encrypted } });
  }
  for (const row of await tx.interopDoctorFacility.findMany({ where: { tenantId, tokenEnc: { not: null } }, select: { id: true, tokenEnc: true } })) {
    const token = reencryptValue(ctx, 'interop_doctor_facility.token', row.tokenEnc);
    if (ctx.write && token) await tx.interopDoctorFacility.update({ where: { id: row.id }, data: { tokenEnc: token.encrypted } });
  }
}

export async function rotateEncryptionKey(prisma: PrismaClient, options: RotateEncryptionKeyOptions): Promise<RotateEncryptionKeyReport> {
  const { oldKey, newKey } = options;
  if (oldKey.length < MIN_KEY_LENGTH) throw new RotateEncryptionKeyError(`Khoá CŨ phải từ ${MIN_KEY_LENGTH} ký tự (đúng giá trị ENCRYPTION_KEY đang chạy).`);
  if (newKey.length < MIN_KEY_LENGTH) throw new RotateEncryptionKeyError(`Khoá MỚI phải từ ${MIN_KEY_LENGTH} ký tự (nên dùng chuỗi ngẫu nhiên 64 ký tự hex).`);
  if (oldKey === newKey) throw new RotateEncryptionKeyError('Khoá mới trùng khoá cũ — không có gì để xoay.');

  const dryRun = options.dryRun ?? false;
  const rotated: Counter = {};
  const unreadable: Counter = {};

  const tenants = await prisma.tenant.findMany({ where: { deletedAt: null, ...(options.tenantIds ? { id: { in: [...options.tenantIds] } } : {}) }, select: { id: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });

  const run = async (write: boolean, tx: Prisma.TransactionClient, rotatedOut: Counter, unreadableOut: Counter) => {
    for (const tenant of tenants) {
      await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenant.id}, true)`;
      await rotateTenant({ tx, tenantId: tenant.id, oldKey, newKey, write, rotated: rotatedOut, unreadable: unreadableOut });
    }
  };

  // Bước 1 — KIỂM (không ghi): giải mã thử mọi giá trị bằng khoá cũ.
  await prisma.$transaction((tx) => run(false, tx, rotated, unreadable), { timeout: 30 * 60_000 });
  const unreadableTotal = Object.values(unreadable).reduce((a, b) => a + b, 0);
  if (unreadableTotal > 0 && !options.allowUnreadable) {
    const detail = Object.entries(unreadable).map(([k, v]) => `${k}: ${v}`).join('; ');
    throw new RotateEncryptionKeyError(`Có ${unreadableTotal} giá trị KHÔNG giải mã được bằng khoá cũ (${detail}) — khoá cũ nhập vào có thể sai. Không ghi gì. Kiểm tra lại OLD_ENCRYPTION_KEY, hoặc đặt ALLOW_UNREADABLE=yes để bỏ qua các giá trị đó.`);
  }
  const report: RotateEncryptionKeyReport = { oldFingerprint: keyFingerprint(oldKey), newFingerprint: keyFingerprint(newKey), dryRun, tenants: tenants.length, rotated, unreadable };
  if (dryRun) return report;

  // Bước 2 — GHI trong MỘT giao dịch: mã hoá lại, xoá phản hồi lưu tạm, đổi mã kiểm khoá, ghi nhật ký.
  const writeRotated: Counter = {};
  const writeUnreadable: Counter = {};
  await prisma.$transaction(
    async (tx) => {
      await run(true, tx, writeRotated, writeUnreadable);
      for (const tenant of tenants) {
        await tx.$executeRaw`SELECT set_config('app.current_tenant_id', ${tenant.id}, true)`;
        await tx.idempotencyKey.deleteMany({ where: { tenantId: tenant.id } });
        await tx.tenantSetting.upsert({
          where: { tenantId_key: { tenantId: tenant.id, key: 'encryption_key_fingerprint' } },
          create: { tenantId: tenant.id, key: 'encryption_key_fingerprint', valueJson: { fingerprint: report.newFingerprint }, createdBy: SYSTEM_ACTOR_ID, updatedBy: SYSTEM_ACTOR_ID },
          update: { valueJson: { fingerprint: report.newFingerprint }, updatedBy: SYSTEM_ACTOR_ID, version: { increment: 1 } },
        });
        await writeAuditLog(tx, tenant.id, {
          actorId: null,
          action: 'system.encryption_key_rotated',
          entityType: 'system',
          entityId: tenant.id,
          afterJson: { oldFingerprint: report.oldFingerprint, newFingerprint: report.newFingerprint },
          ip: null,
          userAgent: 'db:rotate-encryption-key',
        });
      }
      // Người vận hành nền tảng (SaaS): không thuộc công ty nào, không RLS.
      for (const operator of options.tenantIds ? [] : await tx.platformOperator.findMany({ select: { id: true, totpSecretEnc: true } })) {
        const plain = tryDecryptPii(Buffer.from(operator.totpSecretEnc, 'base64'), oldKey);
        bump(plain === null ? writeUnreadable : writeRotated, 'platform_operator.totp_secret');
        if (plain !== null) await tx.platformOperator.update({ where: { id: operator.id }, data: { totpSecretEnc: encryptPii(plain, newKey).toString('base64') } });
      }
    },
    { timeout: 30 * 60_000 },
  );
  // Số liệu cuối cùng lấy từ bước ghi (đã gồm người vận hành nền tảng).
  report.rotated = writeRotated;
  report.unreadable = writeUnreadable;
  return report;
}
