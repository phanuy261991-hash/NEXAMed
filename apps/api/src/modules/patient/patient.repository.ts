import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Patient } from '@prisma/client';

export interface CreatePatientData {
  patientCode: string;
  fullName: string;
  dob: Date;
  gender: string;
  phone: string;
  nationalIdEnc: Buffer | null;
  nationalIdHash: string | null;
  // Cột Json nullable của Prisma cần marker Prisma.JsonNull thay vì `null` thuần để set DB NULL
  // (khác Json bắt buộc, nơi `null` bị hiểu là literal JSON "null") — xem prisma.io/docs.
  addressJson: Prisma.InputJsonValue | typeof Prisma.JsonNull;
  allergyNote: string | null;
}

/** Chỉ field thật sự đổi mới nằm trong object — service tự quyết field nào có mặt. */
export type UpdatePatientData = Partial<CreatePatientData>;

/** Chỗ DUY NHẤT gọi Prisma cho bảng `patient` — theo .claude/docs/coding-standards.md. */
@Injectable()
export class PatientRepository {
  create(tx: Prisma.TransactionClient, tenantId: string, actorId: string, data: CreatePatientData): Promise<Patient> {
    return tx.patient.create({
      data: {
        tenantId,
        ...data,
        createdBy: actorId,
        updatedBy: actorId,
      },
    });
  }

  findById(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<Patient | null> {
    return tx.patient.findFirst({ where: { tenantId, id, deletedAt: null } });
  }

  /**
   * `search`: `raw` khớp `patientCode`/`phone` (startsWith — cả hai đều có tiền tố cố định,
   * người dùng thường gõ từ đầu); `normalized` (đã bỏ dấu + viết thường qua
   * `stripVietnameseDiacritics`, tính ở service) khớp `searchKey` — cột dẫn xuất tận dụng GIN
   * trigram index `patient_tenant_id_search_key_trgm_idx` (S2-02, PAT-02).
   */
  list(
    tx: Prisma.TransactionClient,
    tenantId: string,
    params: { cursor?: string; take: number; search?: { raw: string; normalized: string } },
  ): Promise<Patient[]> {
    const where: Prisma.PatientWhereInput = { tenantId, deletedAt: null };
    if (params.search) {
      where.OR = [
        { patientCode: { startsWith: params.search.raw, mode: 'insensitive' } },
        { phone: { startsWith: params.search.raw } },
        { searchKey: { contains: params.search.normalized } },
      ];
    }
    return tx.patient.findMany({
      where,
      orderBy: { id: 'asc' },
      take: params.take,
      ...(params.cursor ? { cursor: { id: params.cursor }, skip: 1 } : {}),
    });
  }

  /**
   * `updateMany` + kiểm `count` (không phải `update`) vì cần điều kiện `version = ?` trong cùng
   * `WHERE` cho optimistic locking (.claude/docs/data-model.md) — `update()` của Prisma chỉ nhận
   * unique field làm điều kiện, không ghép thêm được `version`.
   */
  async updateIfVersionMatches(
    tx: Prisma.TransactionClient,
    tenantId: string,
    id: string,
    expectedVersion: number,
    actorId: string,
    data: UpdatePatientData,
  ): Promise<number> {
    const result = await tx.patient.updateMany({
      where: { tenantId, id, version: expectedVersion, deletedAt: null },
      data: { ...data, updatedBy: actorId, version: { increment: 1 } },
    });
    return result.count;
  }
}
