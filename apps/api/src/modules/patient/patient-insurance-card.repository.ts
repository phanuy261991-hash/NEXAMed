import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

export interface InsuranceCardRow {
  id: string;
  patientId: string;
  cardNoEnc: Uint8Array;
  cardNoHash: string;
  validFrom: Date | null;
  validTo: Date | null;
  facilityCode: string | null;
  facilityName: string | null;
  benefitRate: number | null;
  photoFrontKey: string | null;
  photoBackKey: string | null;
  createdAt: Date;
  version: number;
}

export interface CreateInsuranceCardData {
  cardNoEnc: Buffer;
  cardNoHash: string;
  validFrom: Date | null;
  validTo: Date | null;
  facilityCode: string | null;
  facilityName: string | null;
  benefitRate: number | null;
}

export type UpdateInsuranceCardData = Partial<CreateInsuranceCardData> & { photoFrontKey?: string | null; photoBackKey?: string | null };

/**
 * Thẻ BHYT của bệnh nhân (S2-04, docs/DECISIONS.md #243) — chỗ DUY NHẤT gọi Prisma cho bảng `insurance_card`
 * (.claude/docs/coding-standards.md). Thẻ theo BỆNH NHÂN nên dùng chung cả công ty: mọi truy vấn chỉ lọc `tenantId`
 * (không có chi nhánh); bản chụp theo từng lượt khám nằm ở `encounter.insurance_snapshot`.
 */
@Injectable()
export class PatientInsuranceCardRepository {
  /** Thẻ còn hiệu lực dữ liệu (chưa xoá mềm) của một bệnh nhân, thẻ thêm gần nhất trước. */
  listForPatient(tx: Prisma.TransactionClient, tenantId: string, patientId: string): Promise<InsuranceCardRow[]> {
    return tx.insuranceCard.findMany({
      where: { tenantId, patientId, deletedAt: null },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
  }

  findById(tx: Prisma.TransactionClient, tenantId: string, patientId: string, id: string): Promise<InsuranceCardRow | null> {
    return tx.insuranceCard.findFirst({ where: { tenantId, patientId, id, deletedAt: null } });
  }

  create(tx: Prisma.TransactionClient, tenantId: string, patientId: string, actorId: string, data: CreateInsuranceCardData): Promise<InsuranceCardRow> {
    return tx.insuranceCard.create({
      data: { tenantId, patientId, ...data, createdBy: actorId, updatedBy: actorId },
    });
  }

  /** `updateMany` + kiểm `count` — cần `version = ?` trong cùng WHERE (optimistic locking), cùng khuôn `PatientRepository.updateIfVersionMatches`. */
  async updateIfVersionMatches(
    tx: Prisma.TransactionClient,
    tenantId: string,
    patientId: string,
    id: string,
    expectedVersion: number,
    actorId: string,
    data: UpdateInsuranceCardData,
  ): Promise<number> {
    const result = await tx.insuranceCard.updateMany({
      where: { tenantId, patientId, id, version: expectedVersion, deletedAt: null },
      data: { ...data, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }

  /** Xoá MỀM (không xoá cứng dữ liệu nghiệp vụ). */
  async softDeleteIfVersionMatches(
    tx: Prisma.TransactionClient,
    tenantId: string,
    patientId: string,
    id: string,
    expectedVersion: number,
    actorId: string,
  ): Promise<number> {
    const result = await tx.insuranceCard.updateMany({
      where: { tenantId, patientId, id, version: expectedVersion, deletedAt: null },
      data: { deletedAt: new Date(), deletedReason: 'removed', updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }

  /** Cảnh báo trùng: bệnh nhân đã có thẻ cùng số (không tính thẻ `excludeId`, vd. chính thẻ đang sửa). */
  async existsHashForPatient(tx: Prisma.TransactionClient, tenantId: string, patientId: string, cardNoHash: string, excludeId?: string): Promise<boolean> {
    const found = await tx.insuranceCard.findFirst({
      where: { tenantId, patientId, cardNoHash, deletedAt: null, ...(excludeId ? { id: { not: excludeId } } : {}) },
      select: { id: true },
    });
    return found !== null;
  }

  /** Tìm bệnh nhân theo số thẻ (khớp CHÍNH XÁC qua mã băm). */
  async findPatientIdsByHash(tx: Prisma.TransactionClient, tenantId: string, cardNoHash: string): Promise<string[]> {
    const rows = await tx.insuranceCard.findMany({
      where: { tenantId, cardNoHash, deletedAt: null },
      select: { patientId: true },
      take: 20,
    });
    return Array.from(new Set(rows.map((r) => r.patientId)));
  }

  /** Gộp hồ sơ (PAT-04): chuyển MỌI thẻ của hồ sơ nguồn sang hồ sơ đích. Trả số thẻ đã chuyển. */
  async moveAll(tx: Prisma.TransactionClient, tenantId: string, fromPatientId: string, toPatientId: string, actorId: string): Promise<number> {
    const result = await tx.insuranceCard.updateMany({
      where: { tenantId, patientId: fromPatientId, deletedAt: null },
      data: { patientId: toPatientId, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }
}
