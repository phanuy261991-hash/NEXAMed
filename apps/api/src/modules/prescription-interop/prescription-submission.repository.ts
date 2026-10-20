import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { InteropSubmissionStatus, PrescriptionKind } from '@nexamed/shared';

/** Một dòng hàng chờ gửi đơn thuốc lên cổng (docs/DECISIONS.md #242 GĐ3, bảng `prescription_submission`). */
export interface PrescriptionSubmissionRecord {
  id: string;
  branchId: string;
  encounterId: string;
  documentId: string;
  nationalCode: string;
  kind: PrescriptionKind;
  doctorUserId: string;
  signedAt: Date;
  status: InteropSubmissionStatus;
  attempts: number;
  lastAttemptAt: Date | null;
  nextAttemptAt: Date | null;
  lockedUntil: Date | null;
  lastHttpStatus: number | null;
  errors: string[];
  sentAt: Date | null;
  version: number;
}

export interface EnqueueSubmissionData {
  branchId: string;
  encounterId: string;
  documentId: string;
  nationalCode: string;
  kind: PrescriptionKind;
  doctorUserId: string;
  signedAt: Date;
}

/** Kết quả một lần xử lý, ghi lại cùng lúc nhả "thuê". */
export interface SubmissionOutcomeData {
  status: InteropSubmissionStatus;
  attempts: number;
  lastAttemptAt: Date | null;
  nextAttemptAt: Date | null;
  lastHttpStatus: number | null;
  errors: string[];
  sentAt: Date | null;
}

export interface ListSubmissionsFilter {
  status?: InteropSubmissionStatus;
  /** Mốc UTC (đầu ngày Việt Nam) — `signedAt >= from`. */
  signedFrom?: Date;
  /** Mốc UTC (đầu ngày Việt Nam kế tiếp) — `signedAt < to`. */
  signedBefore?: Date;
  limit: number;
  offset: number;
}

type Row = Prisma.PrescriptionSubmissionGetPayload<Record<string, never>>;

function toRecord(row: Row): PrescriptionSubmissionRecord {
  return {
    id: row.id,
    branchId: row.branchId,
    encounterId: row.encounterId,
    documentId: row.prescriptionDocumentId,
    nationalCode: row.nationalCode,
    kind: row.kind as PrescriptionKind,
    doctorUserId: row.doctorUserId,
    signedAt: row.signedAt,
    status: row.status as InteropSubmissionStatus,
    attempts: row.attempts,
    lastAttemptAt: row.lastAttemptAt,
    nextAttemptAt: row.nextAttemptAt,
    lockedUntil: row.lockedUntil,
    lastHttpStatus: row.lastHttpStatus,
    errors: Array.isArray(row.errors) ? (row.errors as unknown[]).filter((e): e is string => typeof e === 'string') : [],
    sentAt: row.sentAt,
    version: row.version,
  };
}

/**
 * Hàng chờ gửi đơn thuốc liên thông (docs/DECISIONS.md #242 GĐ3, mockup 8c) — chỗ DUY NHẤT chạm bảng `prescription_submission`. THEO CHI NHÁNH: `branch_id` lấy từ lượt khám lúc xếp hàng; mọi
 * hàm đọc/ghi theo người dùng nhận `branchId` của phiên và lọc theo nó (id của chi nhánh khác → không thấy, service trả 404). Bộ gửi nền chạy theo từng công ty nên dùng các hàm không theo chi nhánh.
 * Không xoá cứng: dòng bị bỏ khi đính chính thì soft-delete.
 */
@Injectable()
export class PrescriptionSubmissionRepository {
  async enqueue(tx: Prisma.TransactionClient, tenantId: string, actorId: string, data: EnqueueSubmissionData): Promise<PrescriptionSubmissionRecord> {
    const row = await tx.prescriptionSubmission.create({
      data: {
        tenantId,
        branchId: data.branchId,
        encounterId: data.encounterId,
        prescriptionDocumentId: data.documentId,
        nationalCode: data.nationalCode,
        kind: data.kind,
        doctorUserId: data.doctorUserId,
        signedAt: data.signedAt,
        createdBy: actorId,
        updatedBy: actorId,
      },
    });
    return toRecord(row);
  }

  async listForEncounter(tx: Prisma.TransactionClient, tenantId: string, encounterId: string): Promise<PrescriptionSubmissionRecord[]> {
    const rows = await tx.prescriptionSubmission.findMany({ where: { tenantId, encounterId, deletedAt: null }, orderBy: { createdAt: 'asc' } });
    return rows.map(toRecord);
  }

  async findActiveByNationalCode(tx: Prisma.TransactionClient, tenantId: string, nationalCode: string): Promise<PrescriptionSubmissionRecord | null> {
    const row = await tx.prescriptionSubmission.findFirst({ where: { tenantId, nationalCode, deletedAt: null } });
    return row ? toRecord(row) : null;
  }

  /** `branchId` bắt buộc: dòng của chi nhánh khác coi như không tồn tại. */
  async findInBranch(tx: Prisma.TransactionClient, tenantId: string, branchId: string, id: string): Promise<PrescriptionSubmissionRecord | null> {
    const row = await tx.prescriptionSubmission.findFirst({ where: { tenantId, branchId, id, deletedAt: null } });
    return row ? toRecord(row) : null;
  }

  /** Dùng cho bộ gửi nền (đã ở đúng công ty nhờ RLS + `tenantId`), không theo chi nhánh. */
  async findById(tx: Prisma.TransactionClient, tenantId: string, id: string): Promise<PrescriptionSubmissionRecord | null> {
    const row = await tx.prescriptionSubmission.findFirst({ where: { tenantId, id, deletedAt: null } });
    return row ? toRecord(row) : null;
  }

  async list(tx: Prisma.TransactionClient, tenantId: string, branchId: string, filter: ListSubmissionsFilter): Promise<{ rows: PrescriptionSubmissionRecord[]; total: number }> {
    const where: Prisma.PrescriptionSubmissionWhereInput = {
      tenantId,
      branchId,
      deletedAt: null,
      ...(filter.status ? { status: filter.status } : {}),
      ...(filter.signedFrom || filter.signedBefore ? { signedAt: { ...(filter.signedFrom ? { gte: filter.signedFrom } : {}), ...(filter.signedBefore ? { lt: filter.signedBefore } : {}) } } : {}),
    };
    const [rows, total] = await Promise.all([
      tx.prescriptionSubmission.findMany({ where, orderBy: [{ signedAt: 'desc' }, { id: 'desc' }], take: filter.limit, skip: filter.offset }),
      tx.prescriptionSubmission.count({ where }),
    ]);
    return { rows: rows.map(toRecord), total };
  }

  /**
   * Nhận tối đa `limit` dòng ĐẾN HẠN (PENDING, `next_attempt_at` rỗng hoặc đã qua, không bị "thuê") của công ty và "thuê" chúng `leaseMinutes` phút. `FOR UPDATE SKIP LOCKED` để hai tiến trình
   * không nhận trùng một dòng. Dùng `now()` của máy chủ DB (không truyền mốc từ JS) để khỏi lệch múi giờ phiên. SQL chỉ nằm ở repository.
   */
  async claimDue(tx: Prisma.TransactionClient, tenantId: string, limit: number, leaseMinutes: number): Promise<string[]> {
    const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      UPDATE prescription_submission
         SET locked_until = now() + make_interval(mins => ${leaseMinutes}::int), updated_at = now(), version = version + 1
       WHERE tenant_id = ${tenantId}::uuid
         AND id IN (
           SELECT id FROM prescription_submission
            WHERE tenant_id = ${tenantId}::uuid
              AND deleted_at IS NULL
              AND status = 'PENDING'
              AND (next_attempt_at IS NULL OR next_attempt_at <= now())
              AND (locked_until IS NULL OR locked_until < now())
            ORDER BY created_at
            LIMIT ${limit}::int
              FOR UPDATE SKIP LOCKED)
      RETURNING id`);
    return rows.map((r) => r.id);
  }

  /** "Gửi ngay"/"Gửi lại" của người dùng: "thuê" đúng dòng này nếu chưa ai thuê và đang PENDING/FAILED. 0 = không nhận được (đang gửi hoặc trạng thái không cho). */
  async claimOne(tx: Prisma.TransactionClient, tenantId: string, branchId: string, id: string, leaseMinutes: number): Promise<number> {
    const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      UPDATE prescription_submission
         SET locked_until = now() + make_interval(mins => ${leaseMinutes}::int), updated_at = now(), version = version + 1
       WHERE tenant_id = ${tenantId}::uuid AND branch_id = ${branchId}::uuid AND id = ${id}::uuid
         AND deleted_at IS NULL
         AND status IN ('PENDING', 'FAILED')
         AND (locked_until IS NULL OR locked_until < now())
      RETURNING id`);
    return rows.length;
  }

  /** Ghi kết quả một lần xử lý và nhả "thuê". */
  async release(tx: Prisma.TransactionClient, tenantId: string, actorId: string, id: string, outcome: SubmissionOutcomeData): Promise<void> {
    await tx.prescriptionSubmission.updateMany({
      where: { tenantId, id, deletedAt: null },
      data: {
        status: outcome.status,
        attempts: outcome.attempts,
        lastAttemptAt: outcome.lastAttemptAt,
        nextAttemptAt: outcome.nextAttemptAt,
        lastHttpStatus: outcome.lastHttpStatus,
        errors: outcome.errors as Prisma.InputJsonValue,
        sentAt: outcome.sentAt,
        lockedUntil: null,
        updatedBy: actorId,
        version: { increment: 1 },
      },
    });
  }

  /** Người dùng vừa bổ sung dữ liệu (ô 8b) → các dòng đang CHỜ của lượt khám được xem lại ngay thay vì đợi hết 30 phút. */
  async resetNextAttemptForEncounter(tx: Prisma.TransactionClient, tenantId: string, actorId: string, encounterId: string): Promise<void> {
    await tx.prescriptionSubmission.updateMany({
      where: { tenantId, encounterId, deletedAt: null, status: 'PENDING', nextAttemptAt: { not: null } },
      data: { nextAttemptAt: null, updatedBy: actorId, version: { increment: 1 } },
    });
  }

  /**
   * Sau khi ĐÍNH CHÍNH đơn: đơn pháp lý giữ cùng mã nhưng là dòng `prescription_document` MỚI (bản cũ soft-delete), nên dòng hàng chờ phải trỏ sang đơn mới.
   * - mã còn nguyên: PENDING/FAILED giữ trạng thái (gửi bản mới nhất); SENT → AMENDED ("Đính chính, chưa gửi" — tài liệu không có API sửa đơn đã gửi); AMENDED giữ.
   * - mã mới (loại đơn mới xuất hiện) và công tắc liên thông đang bật: xếp hàng mới.
   * - mã cũ không còn: PENDING/FAILED bị huỷ (soft-delete); SENT → AMENDED.
   */
  async syncAfterAmend(
    tx: Prisma.TransactionClient,
    tenantId: string,
    actorId: string,
    args: {
      branchId: string;
      encounterId: string;
      previousCodes: string[];
      newDocuments: { id: string; kind: PrescriptionKind; nationalCode: string }[];
      doctorUserId: string;
      signedAt: Date;
      enqueueNew: boolean;
    },
  ): Promise<void> {
    const newCodes = new Set(args.newDocuments.map((d) => d.nationalCode));
    for (const doc of args.newDocuments) {
      const existing = await this.findActiveByNationalCode(tx, tenantId, doc.nationalCode);
      if (!existing) {
        if (args.enqueueNew) {
          await this.enqueue(tx, tenantId, actorId, {
            branchId: args.branchId,
            encounterId: args.encounterId,
            documentId: doc.id,
            nationalCode: doc.nationalCode,
            kind: doc.kind,
            doctorUserId: args.doctorUserId,
            signedAt: args.signedAt,
          });
        }
        continue;
      }
      await tx.prescriptionSubmission.updateMany({
        where: { tenantId, id: existing.id, deletedAt: null },
        data: {
          prescriptionDocumentId: doc.id,
          ...(existing.status === 'SENT' ? { status: 'AMENDED' } : { doctorUserId: args.doctorUserId }),
          updatedBy: actorId,
          version: { increment: 1 },
        },
      });
    }
    for (const code of args.previousCodes) {
      if (newCodes.has(code)) continue;
      const stale = await this.findActiveByNationalCode(tx, tenantId, code);
      if (!stale) continue;
      if (stale.status === 'SENT') {
        await tx.prescriptionSubmission.updateMany({ where: { tenantId, id: stale.id, deletedAt: null }, data: { status: 'AMENDED', updatedBy: actorId, version: { increment: 1 } } });
      } else if (stale.status !== 'AMENDED') {
        await tx.prescriptionSubmission.updateMany({
          where: { tenantId, id: stale.id, deletedAt: null },
          data: { deletedAt: new Date(), deletedReason: 'amended_removed', lockedUntil: null, updatedBy: actorId, version: { increment: 1 } },
        });
      }
    }
  }
}
