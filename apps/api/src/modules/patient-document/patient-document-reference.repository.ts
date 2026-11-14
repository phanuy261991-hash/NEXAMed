import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

/**
 * Giai đoạn 2 của tab "Hình ảnh & Tài liệu" (docs/DECISIONS.md #299 bổ sung 3) — chỗ gọi Prisma để ĐỌC các nguồn (kết quả cận lâm sàng đã duyệt, thẻ BHYT, ảnh đại diện) và
 * GHI các dòng tham chiếu chỉ đọc của `patient_document`. Chỉ SQL, không nghiệp vụ: việc so khớp nằm ở `planReferenceSync` (core) và `PatientDocumentReferenceSync` (service).
 * Tệp theo BỆNH NHÂN nên chung cả công ty: mọi truy vấn chỉ lọc `tenantId` + `patientId`, không lọc chi nhánh.
 */

/** Khoá cài công tắc "Áp dụng BHYT" ở `tenant_setting` (cùng khoá với `ClinicSettingsRepository`). */
const INSURANCE_ENABLED_KEY = 'insurance_enabled';

export interface ExistingReferenceRow {
  id: string;
  sourceType: 'PARACLINICAL_IMAGE' | 'LAB_PARTNER_RESULT' | 'INSURANCE_CARD' | 'PATIENT_PHOTO';
  sourceId: string;
  storageKey: string;
  encounterId: string | null;
  branchId: string;
}

export interface SignedResultImage {
  id: string;
  storageKey: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  createdAt: Date;
  createdBy: string;
  orderItemId: string;
  encounterId: string;
  branchId: string;
}

export interface InsuranceCardPhotos {
  id: string;
  photoFrontKey: string | null;
  photoBackKey: string | null;
  updatedAt: Date;
  updatedBy: string;
}

export interface AuditStamp {
  entityId: string;
  actorId: string | null;
  occurredAt: Date;
  afterJson: Prisma.JsonValue | null;
}

export interface NewReferenceRow {
  tenantId: string;
  patientId: string;
  branchId: string;
  encounterId: string | null;
  category: 'PARACLINICAL' | 'CONTRACT' | 'OTHER';
  sourceType: ExistingReferenceRow['sourceType'];
  sourceId: string;
  storageKey: string;
  fileName: string;
  displayName: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: Date;
  uploadDate: Date;
  createdBy: string;
  updatedBy: string;
}

export interface ResultImageContext {
  orderItemId: string;
  serviceName: string;
  encounterId: string;
  /** Nhóm màn kết quả để mở: xét nghiệm (kể cả PDF đối tác) hay chẩn đoán hình ảnh/thăm dò chức năng. */
  group: 'lab' | 'imaging';
}

@Injectable()
export class PatientDocumentReferenceRepository {
  /** Các dòng tham chiếu chưa xoá mềm của bệnh nhân (mọi loại nguồn trừ tải tay). */
  async listReferenceRows(tx: Prisma.TransactionClient, tenantId: string, patientId: string): Promise<ExistingReferenceRow[]> {
    return tx.patientDocument.findMany({
      where: { tenantId, patientId, deletedAt: null, sourceType: { not: 'UPLOAD' } },
      select: { id: true, sourceType: true, sourceId: true, storageKey: true, encounterId: true, branchId: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }) as Promise<ExistingReferenceRow[]>;
  }

  /**
   * Ảnh/PDF của kết quả cận lâm sàng ĐÃ DUYỆT và còn hiệu lực (kết quả bị đính chính thì bản gốc đã xoá mềm, bản nháp đính chính chưa ký nên chưa hiện).
   * PDF của đối tác cũng nằm ở đây vì lúc nhận kết quả đã được ghi thành một ảnh của kết quả. Sắp cũ nhất trước để dòng đại diện của một tệp dùng chung ổn định.
   */
  async listSignedResultImages(tx: Prisma.TransactionClient, tenantId: string, patientId: string): Promise<SignedResultImage[]> {
    const rows = await tx.paraclinicalResultImage.findMany({
      where: {
        tenantId,
        deletedAt: null,
        result: { deletedAt: null, signedAt: { not: null }, orderItem: { deletedAt: null, order: { deletedAt: null, encounter: { patientId, deletedAt: null } } } },
      },
      select: {
        id: true,
        storageKey: true,
        fileName: true,
        contentType: true,
        sizeBytes: true,
        createdAt: true,
        createdBy: true,
        result: { select: { orderItem: { select: { id: true, order: { select: { encounter: { select: { id: true, branchId: true } } } } } } } },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    return rows.map((r) => ({
      id: r.id,
      storageKey: r.storageKey,
      fileName: r.fileName,
      contentType: r.contentType,
      sizeBytes: r.sizeBytes,
      createdAt: r.createdAt,
      createdBy: r.createdBy,
      orderItemId: r.result.orderItem.id,
      encounterId: r.result.orderItem.order.encounter.id,
      branchId: r.result.orderItem.order.encounter.branchId,
    }));
  }

  /** Thẻ BHYT chưa xoá mềm có ít nhất một ảnh. */
  listInsuranceCardPhotos(tx: Prisma.TransactionClient, tenantId: string, patientId: string): Promise<InsuranceCardPhotos[]> {
    return tx.insuranceCard.findMany({
      where: { tenantId, patientId, deletedAt: null, OR: [{ photoFrontKey: { not: null } }, { photoBackKey: { not: null } }] },
      select: { id: true, photoFrontKey: true, photoBackKey: true, updatedAt: true, updatedBy: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  /** Công tắc "Áp dụng BHYT" (chung cả công ty, mặc định tắt). Tắt thì ảnh thẻ không hiện ở tab. */
  async insuranceEnabled(tx: Prisma.TransactionClient, tenantId: string): Promise<boolean> {
    const setting = await tx.tenantSetting.findFirst({ where: { tenantId, key: INSURANCE_ENABLED_KEY, deletedAt: null } });
    return setting?.valueJson === true;
  }

  /** Lần ghi nhật ký mới nhất của từng thực thể với một hành động — dùng để biết AI đã đặt ảnh và LÚC NÀO (các bảng nguồn không lưu thời điểm riêng của ảnh). */
  async latestAuditStamps(tx: Prisma.TransactionClient, tenantId: string, entityType: string, action: string, entityIds: string[]): Promise<AuditStamp[]> {
    if (entityIds.length === 0) return [];
    return tx.auditLog.findMany({
      where: { tenantId, entityType, action, entityId: { in: entityIds } },
      select: { entityId: true, actorId: true, occurredAt: true, afterJson: true },
      orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
    });
  }

  /** Chi nhánh mặc định của công ty — nơi "ghi nhận" dòng không gắn chi nhánh nào (thẻ BHYT, ảnh đại diện đi theo bệnh nhân). */
  async defaultBranchId(tx: Prisma.TransactionClient, tenantId: string): Promise<string | null> {
    const branch =
      (await tx.branch.findFirst({ where: { tenantId, deletedAt: null, isDefault: true }, select: { id: true } })) ??
      (await tx.branch.findFirst({ where: { tenantId, deletedAt: null }, select: { id: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }));
    return branch?.id ?? null;
  }

  /** `skipDuplicates` (ON CONFLICT DO NOTHING): hai lần mở tab đồng thời cùng thêm một dòng thì dòng thứ hai bị bỏ qua thay vì làm hỏng giao dịch. */
  async createMany(tx: Prisma.TransactionClient, rows: NewReferenceRow[]): Promise<number> {
    if (rows.length === 0) return 0;
    const result = await tx.patientDocument.createMany({
      data: rows.map((r) => ({ ...r })),
      skipDuplicates: true,
    });
    return result.count;
  }

  async updateSource(tx: Prisma.TransactionClient, tenantId: string, id: string, data: { sourceType: ExistingReferenceRow['sourceType']; sourceId: string; encounterId: string | null; branchId: string }): Promise<void> {
    await tx.patientDocument.updateMany({ where: { tenantId, id, deletedAt: null, sourceType: { not: 'UPLOAD' } }, data: { ...data, version: { increment: 1 } } });
  }

  /** Gỡ MỀM các dòng tham chiếu (nguồn đã mất) — tệp gốc không bị đụng tới. */
  async softDeleteMany(tx: Prisma.TransactionClient, tenantId: string, ids: string[], actorId: string): Promise<void> {
    if (ids.length === 0) return;
    await tx.patientDocument.updateMany({
      where: { tenantId, id: { in: ids }, deletedAt: null, sourceType: { not: 'UPLOAD' } },
      data: { deletedAt: new Date(), deletedReason: 'source_removed', updatedBy: actorId, version: { increment: 1 } },
    });
  }

  /** Dịch vụ (tên, id) và lượt khám của các ảnh kết quả mà dòng tham chiếu đang trỏ tới — để hiện "Kết quả CLS · tên dịch vụ" và nút "Mở kết quả". Không lọc xoá mềm. */
  async resultImageContexts(tx: Prisma.TransactionClient, tenantId: string, imageIds: string[]): Promise<Map<string, ResultImageContext>> {
    if (imageIds.length === 0) return new Map();
    const rows = await tx.paraclinicalResultImage.findMany({
      where: { tenantId, id: { in: imageIds } },
      select: { id: true, result: { select: { orderItem: { select: { id: true, name: true, order: { select: { encounterId: true } }, technicalService: { select: { serviceKind: true } } } } } } },
    });
    return new Map(
      rows.map((r) => [
        r.id,
        {
          orderItemId: r.result.orderItem.id,
          serviceName: r.result.orderItem.name,
          encounterId: r.result.orderItem.order.encounterId,
          group: r.result.orderItem.technicalService?.serviceKind === 'LAB' ? ('lab' as const) : ('imaging' as const),
        },
      ]),
    );
  }
}
