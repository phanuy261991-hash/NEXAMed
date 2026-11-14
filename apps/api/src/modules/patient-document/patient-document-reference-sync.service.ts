import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { DOCUMENT_CONTENT_TYPE, STORAGE_PORT, getVietnamDateString, planReferenceSync, type StoragePort } from '@nexamed/core';
import { PATIENT_DOCUMENT_DISPLAY_NAME_MAX } from '@nexamed/shared';
import { PatientDocumentReferenceRepository, type ExistingReferenceRow, type NewReferenceRow } from './patient-document-reference.repository';

/**
 * Giai đoạn 2 của tab "Hình ảnh & Tài liệu" (docs/DECISIONS.md #299 bổ sung 3): TỰ GỘP ảnh/PDF cận lâm sàng, ảnh thẻ BHYT và ảnh đại diện vào tab dưới dạng dòng THAM CHIẾU chỉ đọc
 * (cùng khoá lưu với tệp gốc, KHÔNG nhân đôi tệp). Thay vì chèn lệnh ghi vào 4 module nguồn, tab tự đối chiếu với nguồn mỗi lần mở trang đầu (`PatientDocumentService.list`):
 * thêm dòng còn thiếu, cập nhật dòng đã đổi nguồn, gỡ mềm dòng mà nguồn đã mất. Dữ liệu cũ cũng được nạp bù theo cách này ở lần mở đầu tiên của từng bệnh nhân.
 * Chạy trong CÙNG transaction của lần đọc; chỉ gọi StoragePort để lấy dung lượng ảnh thẻ/ảnh đại diện lần đầu (không mở transaction nào — #264).
 */

type ReferenceSourceType = ExistingReferenceRow['sourceType'];

interface DesiredReference {
  sourceType: ReferenceSourceType;
  sourceId: string;
  storageKey: string;
  category: NewReferenceRow['category'];
  encounterId: string | null;
  branchId: string;
  fileName: string;
  contentType: string;
  /** `null` = chưa biết (ảnh thẻ/ảnh đại diện không lưu dung lượng) → đọc từ kho lúc tạo dòng. */
  sizeBytes: number | null;
  actorId: string;
  at: Date;
}

/** Thông tin hồ sơ cần để dựng dòng "Ảnh đại diện". */
export interface PatientPhotoSource {
  patientId: string;
  photoKey: string | null;
  updatedAt: Date;
  updatedBy: string;
}

const IMAGE_TYPES: Record<string, string> = { jpg: DOCUMENT_CONTENT_TYPE.jpg, jpeg: DOCUMENT_CONTENT_TYPE.jpg, png: DOCUMENT_CONTENT_TYPE.png };

function extensionOf(key: string): string {
  const dot = key.lastIndexOf('.');
  return dot < 0 ? '' : key.slice(dot + 1).toLowerCase();
}

const clampName = (name: string): string => name.slice(0, PATIENT_DOCUMENT_DISPLAY_NAME_MAX);

@Injectable()
export class PatientDocumentReferenceSync {
  constructor(
    private readonly repository: PatientDocumentReferenceRepository,
    @Inject(STORAGE_PORT) private readonly storage: StoragePort,
  ) {}

  /** Đối chiếu dòng tham chiếu của MỘT bệnh nhân với các nguồn. Idempotent: lần thứ hai không ghi gì. `actorId` = người đang mở tab (chỉ dùng khi gỡ mềm). */
  async sync(tx: Prisma.TransactionClient, tenantId: string, actorId: string, patient: PatientPhotoSource): Promise<void> {
    const defaultBranchId = await this.repository.defaultBranchId(tx, tenantId);
    if (!defaultBranchId) return;
    const [existing, images, insuranceOn] = await Promise.all([
      this.repository.listReferenceRows(tx, tenantId, patient.patientId),
      this.repository.listSignedResultImages(tx, tenantId, patient.patientId),
      this.repository.insuranceEnabled(tx, tenantId),
    ]);

    const desired: DesiredReference[] = images.map((img) => ({
      sourceType: 'PARACLINICAL_IMAGE',
      sourceId: img.id,
      storageKey: img.storageKey,
      category: 'PARACLINICAL',
      encounterId: img.encounterId,
      branchId: img.branchId,
      fileName: clampName(img.fileName),
      contentType: img.contentType,
      sizeBytes: img.sizeBytes,
      actorId: img.createdBy,
      at: img.createdAt,
    }));
    if (insuranceOn) desired.push(...(await this.cardReferences(tx, tenantId, patient.patientId, defaultBranchId)));
    const avatar = await this.avatarReference(tx, tenantId, patient, defaultBranchId);
    if (avatar) desired.push(avatar);

    const plan = planReferenceSync(desired, existing);

    const created: NewReferenceRow[] = [];
    for (const entry of plan.toCreate) {
      const sizeBytes = entry.sizeBytes ?? (await this.sizeOf(tenantId, entry.storageKey));
      if (sizeBytes === null) continue; // tệp gốc không còn trong kho → không có gì để hiện
      created.push({
        tenantId,
        patientId: patient.patientId,
        branchId: entry.branchId,
        encounterId: entry.encounterId,
        category: entry.category,
        sourceType: entry.sourceType,
        sourceId: entry.sourceId,
        storageKey: entry.storageKey,
        fileName: entry.fileName,
        displayName: entry.fileName,
        contentType: entry.contentType,
        sizeBytes,
        uploadedAt: entry.at,
        uploadDate: new Date(getVietnamDateString(entry.at)),
        createdBy: entry.actorId,
        updatedBy: entry.actorId,
      });
    }
    await this.repository.softDeleteMany(tx, tenantId, plan.toRemoveIds, actorId);
    for (const update of plan.toUpdate) await this.repository.updateSource(tx, tenantId, update.id, { ...update.data, sourceType: update.data.sourceType as ReferenceSourceType });
    await this.repository.createMany(tx, created);
  }

  /** Ảnh mặt trước/mặt sau của từng thẻ BHYT. Người đặt ảnh và thời điểm lấy từ nhật ký "đổi ảnh thẻ"; thẻ cũ chưa có nhật ký thì dùng lần sửa thẻ gần nhất. */
  private async cardReferences(tx: Prisma.TransactionClient, tenantId: string, patientId: string, branchId: string): Promise<DesiredReference[]> {
    const cards = await this.repository.listInsuranceCardPhotos(tx, tenantId, patientId);
    if (cards.length === 0) return [];
    const stamps = await this.repository.latestAuditStamps(tx, tenantId, 'insurance_card', 'insurance_card.photo_updated', cards.map((c) => c.id));
    const out: DesiredReference[] = [];
    for (const card of cards) {
      for (const side of ['front', 'back'] as const) {
        const key = side === 'front' ? card.photoFrontKey : card.photoBackKey;
        if (!key) continue;
        const contentType = IMAGE_TYPES[extensionOf(key)];
        if (!contentType) continue;
        const stamp = stamps.find((s) => s.entityId === card.id && (s.afterJson as { side?: string } | null)?.side === side);
        out.push({
          sourceType: 'INSURANCE_CARD',
          sourceId: card.id,
          storageKey: key,
          category: 'CONTRACT',
          encounterId: null,
          branchId,
          fileName: `Thẻ BHYT - ${side === 'front' ? 'mặt trước' : 'mặt sau'}.${extensionOf(key) === 'jpeg' ? 'jpg' : extensionOf(key)}`,
          contentType,
          sizeBytes: null,
          actorId: stamp?.actorId ?? card.updatedBy,
          at: stamp?.occurredAt ?? card.updatedAt,
        });
      }
    }
    return out;
  }

  private async avatarReference(tx: Prisma.TransactionClient, tenantId: string, patient: PatientPhotoSource, branchId: string): Promise<DesiredReference | null> {
    if (!patient.photoKey) return null;
    const contentType = IMAGE_TYPES[extensionOf(patient.photoKey)];
    if (!contentType) return null;
    const [stamp] = await this.repository.latestAuditStamps(tx, tenantId, 'patient', 'patient.photo_updated', [patient.patientId]);
    return {
      sourceType: 'PATIENT_PHOTO',
      sourceId: patient.patientId,
      storageKey: patient.photoKey,
      category: 'OTHER',
      encounterId: null,
      branchId,
      fileName: `Ảnh đại diện.${extensionOf(patient.photoKey) === 'jpeg' ? 'jpg' : extensionOf(patient.photoKey)}`,
      contentType,
      sizeBytes: null,
      actorId: stamp?.actorId ?? patient.updatedBy,
      at: stamp?.occurredAt ?? patient.updatedAt,
    };
  }

  private async sizeOf(tenantId: string, key: string): Promise<number | null> {
    try {
      return (await this.storage.read(tenantId, key)).byteLength;
    } catch {
      return null;
    }
  }
}
