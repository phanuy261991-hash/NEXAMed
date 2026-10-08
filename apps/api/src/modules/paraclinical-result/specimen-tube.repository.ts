import { Injectable } from '@nestjs/common';
import { Prisma, type SpecimenCollectVia } from '@prisma/client';

/** Dòng chỉ định còn hiệu lực của một ống, kèm nhóm dịch vụ (viết tắt in trên tem) và cờ "đã có kết quả" (kể cả nháp). */
const TUBE_INCLUDE = {
  items: {
    where: { deletedAt: null, status: { not: 'CANCELLED' as const } },
    orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }],
    select: {
      id: true,
      name: true,
      status: true,
      technicalService: { select: { categoryCode: true, specimenTypeCode: true, departmentId: true } },
      results: { where: { deletedAt: null }, select: { id: true }, take: 1 },
    },
  },
} satisfies Prisma.SpecimenTubeInclude;

export type TubeRow = Prisma.SpecimenTubeGetPayload<{ include: typeof TUBE_INCLUDE }>;

export interface CreateTubeData {
  clinicalOrderId: string;
  sid: string;
  specimenTypeCode: string | null;
  specimenName: string | null;
  capColor: string | null;
  replacesTubeId?: string | null;
}

/** Chỗ DUY NHẤT gọi Prisma cho `specimen_tube` (Lấy mẫu xét nghiệm có tem mã vạch, docs/DECISIONS.md #220). Luôn lọc `tenantId` + `deletedAt IS NULL`. */
@Injectable()
export class SpecimenTubeRepository {
  /** Mọi ống của một phiếu (kể cả đã huỷ để truy vết), theo thứ tự tạo. */
  findByOrder(tx: Prisma.TransactionClient, tenantId: string, clinicalOrderId: string): Promise<TubeRow[]> {
    return tx.specimenTube.findMany({
      where: { tenantId, clinicalOrderId, deletedAt: null },
      include: TUBE_INCLUDE,
      orderBy: [{ createdAt: 'asc' }, { sid: 'asc' }],
    });
  }

  findByIds(tx: Prisma.TransactionClient, tenantId: string, ids: string[]): Promise<TubeRow[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return tx.specimenTube.findMany({ where: { tenantId, id: { in: ids }, deletedAt: null }, include: TUBE_INCLUDE });
  }

  findBySid(tx: Prisma.TransactionClient, tenantId: string, sid: string): Promise<TubeRow | null> {
    return tx.specimenTube.findFirst({ where: { tenantId, sid, deletedAt: null }, include: TUBE_INCLUDE });
  }

  /** SID của ống thay thế (ống mới có `replaces_tube_id` = ống đã huỷ) — cho nhãn "thay 2610080016" và cảnh báo khi quét ống đã huỷ. */
  findReplacementSid(tx: Prisma.TransactionClient, tenantId: string, replacedTubeId: string): Promise<{ sid: string } | null> {
    return tx.specimenTube.findFirst({ where: { tenantId, replacesTubeId: replacedTubeId, deletedAt: null }, select: { sid: true }, orderBy: { createdAt: 'desc' } });
  }

  create(tx: Prisma.TransactionClient, tenantId: string, actorId: string, data: CreateTubeData): Promise<{ id: string; sid: string }> {
    return tx.specimenTube.create({
      data: {
        tenantId,
        clinicalOrderId: data.clinicalOrderId,
        sid: data.sid,
        specimenTypeCode: data.specimenTypeCode,
        specimenName: data.specimenName,
        capColor: data.capColor,
        replacesTubeId: data.replacesTubeId ?? null,
        createdBy: actorId,
        updatedBy: actorId,
      },
      select: { id: true, sid: true },
    });
  }

  /** Ghi nhận in tem: +1 lần in, nhớ giờ và người in cuối. Trả số ống cập nhật. */
  async markPrinted(tx: Prisma.TransactionClient, tenantId: string, ids: string[], actorId: string, at: Date): Promise<number> {
    const r = await tx.specimenTube.updateMany({
      where: { tenantId, id: { in: ids }, deletedAt: null, status: { not: 'CANCELLED' } },
      data: { printCount: { increment: 1 }, lastPrintedAt: at, lastPrintedBy: actorId, updatedBy: actorId, version: { increment: 1 } },
    });
    return r.count;
  }

  /** PENDING → COLLECTED. `WHERE status='PENDING'` chống 2 người xác nhận cùng lúc; trả 1 nếu thành công. */
  async markCollected(tx: Prisma.TransactionClient, tenantId: string, id: string, actorId: string, at: Date, via: SpecimenCollectVia): Promise<number> {
    const r = await tx.specimenTube.updateMany({
      where: { tenantId, id, deletedAt: null, status: 'PENDING' },
      data: { status: 'COLLECTED', collectedAt: at, collectedBy: actorId, collectedVia: via, updatedBy: actorId, version: { increment: 1 } },
    });
    return r.count;
  }

  /** COLLECTED → PENDING (huỷ xác nhận đã lấy mẫu): xoá giờ, người và cách xác nhận. */
  async revertCollected(tx: Prisma.TransactionClient, tenantId: string, id: string, actorId: string): Promise<number> {
    const r = await tx.specimenTube.updateMany({
      where: { tenantId, id, deletedAt: null, status: 'COLLECTED' },
      data: { status: 'PENDING', collectedAt: null, collectedBy: null, collectedVia: null, updatedBy: actorId, version: { increment: 1 } },
    });
    return r.count;
  }

  /** PENDING/COLLECTED → CANCELLED kèm lý do (bắt buộc theo ràng buộc DB). */
  async cancel(tx: Prisma.TransactionClient, tenantId: string, id: string, actorId: string, reason: string): Promise<number> {
    const r = await tx.specimenTube.updateMany({
      where: { tenantId, id, deletedAt: null, status: { not: 'CANCELLED' } },
      data: { status: 'CANCELLED', cancelReason: reason, updatedBy: actorId, version: { increment: 1 } },
    });
    return r.count;
  }
}
