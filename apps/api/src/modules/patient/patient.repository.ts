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
  personalHistory: string | null;
  familyHistory: string | null;
  // Mở rộng hồ sơ hành chính (docs/DECISIONS.md #034) — text/date tự do, không danh mục.
  nationalIdIssuedAt: Date | null;
  nationalIdIssuedPlace: string | null;
  ethnicity: string | null;
  nationality: string | null;
  occupation: string | null;
  insuranceNumber: string | null;
  relativeFullName: string | null;
  relativeRelationship: string | null;
  relativePhone: string | null;
  relativeAddress: string | null;
}

/**
 * Chỉ field thật sự đổi mới nằm trong object — service tự quyết field nào có mặt. `photoKey`
 * không thuộc `CreatePatientData` (ảnh chỉ đổi qua endpoint upload riêng, `PatientService.
 * uploadPhoto()` — không tạo được lúc `POST /patients` vì chưa có `id` để đặt tên key).
 */
export type UpdatePatientData = Partial<CreatePatientData> & { photoKey?: string | null };

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
   * PAT-03 — trùng "mềm": khớp CHÍNH XÁC `searchKey` (cột dẫn xuất, đã bỏ dấu + viết thường —
   * xem S2-02) + `dob`, khác `list()` dùng `contains` cho tìm kiếm gợi ý. `take: 10` chặn kết quả
   * phòng trường hợp bất thường (nhiều hồ sơ trùng cả tên lẫn ngày sinh) — về nghiệp vụ số này
   * gần như luôn 0 hoặc 1.
   */
  findPossibleDuplicates(
    tx: Prisma.TransactionClient,
    tenantId: string,
    params: { normalizedFullName: string; dob: Date },
  ): Promise<Patient[]> {
    return tx.patient.findMany({
      where: { tenantId, deletedAt: null, searchKey: params.normalizedFullName, dob: params.dob },
      orderBy: { id: 'asc' },
      take: 10,
    });
  }

  /**
   * Tra trùng SĐT — khớp CHÍNH XÁC (không `startsWith` như `list()`), dùng index có sẵn
   * `(tenant_id, phone)`. `excludePatientId`: loại chính hồ sơ đang sửa. Xem
   * `packages/shared/src/patient.ts` (`patientByPhoneQuerySchema`) — KHÁC PAT-03
   * (`findPossibleDuplicates`, khớp tên+ngày sinh): SĐT được phép trùng thật sự, đây chỉ liệt kê
   * để cảnh báo mềm hoặc để lễ tân chọn đúng người ở trang Tiếp nhận, không phải phát hiện trùng
   * hồ sơ.
   */
  findByPhone(
    tx: Prisma.TransactionClient,
    tenantId: string,
    params: { phone: string; excludePatientId?: string },
  ): Promise<Patient[]> {
    return tx.patient.findMany({
      where: {
        tenantId,
        deletedAt: null,
        phone: params.phone,
        ...(params.excludePatientId ? { id: { not: params.excludePatientId } } : {}),
      },
      orderBy: { id: 'asc' },
      take: 10,
    });
  }

  /**
   * Tra trùng CCCD (màn hình "Tiếp nhận bệnh nhân", mockup đã duyệt) — khớp CHÍNH XÁC
   * `nationalIdHash` (đã băm ở service qua `hashForLookup`, cùng cơ chế C3 chặn trùng lúc tạo/sửa
   * — .claude/docs/data-model.md). Về nghiệp vụ tối đa 1 kết quả (CCCD là duy nhất trong tenant)
   * nhưng vẫn trả mảng, cùng hình dạng `findByPhone()` để nơi gọi dùng chung một kiểu xử lý.
   */
  findByNationalIdHash(
    tx: Prisma.TransactionClient,
    tenantId: string,
    params: { nationalIdHash: string; excludePatientId?: string },
  ): Promise<Patient[]> {
    return tx.patient.findMany({
      where: {
        tenantId,
        deletedAt: null,
        nationalIdHash: params.nationalIdHash,
        ...(params.excludePatientId ? { id: { not: params.excludePatientId } } : {}),
      },
      orderBy: { id: 'asc' },
      take: 10,
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
