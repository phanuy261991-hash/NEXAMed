import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

const FINGERPRINT_KEY = 'encryption_key_fingerprint';

/** Tầng truy cập dữ liệu của kiểm tra khoá mã hoá (#262): mã kiểm khoá đã ghi + một mẫu dữ liệu mã hoá để thử giải mã. */
@Injectable()
export class EncryptionKeyRepository {
  /** Mã kiểm khoá đã ghi lúc dữ liệu được tạo (`tenant_setting`), hoặc `null` nếu chưa từng ghi (hệ thống cài trước bản này). */
  async getStoredFingerprint(tx: Prisma.TransactionClient, tenantId: string): Promise<string | null> {
    const row = await tx.tenantSetting.findFirst({ where: { tenantId, key: FINGERPRINT_KEY, deletedAt: null } });
    const value = row?.valueJson as { fingerprint?: unknown } | null | undefined;
    return typeof value?.fingerprint === 'string' ? value.fingerprint : null;
  }

  async saveFingerprint(tx: Prisma.TransactionClient, tenantId: string, actorId: string, fingerprint: string): Promise<void> {
    await tx.tenantSetting.upsert({
      where: { tenantId_key: { tenantId, key: FINGERPRINT_KEY } },
      create: { tenantId, key: FINGERPRINT_KEY, valueJson: { fingerprint }, createdBy: actorId, updatedBy: actorId },
      update: { valueJson: { fingerprint }, updatedBy: actorId, version: { increment: 1 } },
    });
  }

  /** Một dữ liệu đã mã hoá bất kỳ của công ty để thử giải mã (CCCD bệnh nhân, rồi số thẻ BHYT). `null` nếu công ty chưa có dữ liệu mã hoá nào. */
  async findSampleCipher(tx: Prisma.TransactionClient, tenantId: string): Promise<Buffer | null> {
    const patient = await tx.patient.findFirst({ where: { tenantId, nationalIdEnc: { not: null } }, select: { nationalIdEnc: true }, orderBy: { createdAt: 'asc' } });
    if (patient?.nationalIdEnc) return Buffer.from(patient.nationalIdEnc);
    const card = await tx.insuranceCard.findFirst({ where: { tenantId }, select: { cardNoEnc: true }, orderBy: { createdAt: 'asc' } });
    return card ? Buffer.from(card.cardNoEnc) : null;
  }
}
