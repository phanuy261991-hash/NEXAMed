import type { PrismaClient } from '@prisma/client';
import { SYSTEM_TEST_ACTOR } from './tenant-fixture';

/**
 * Dựng nhanh một kết quả cận lâm sàng (kèm ảnh/PDF đính kèm) cho spec cần dữ liệu "tab Hình ảnh & Tài liệu" (docs/DECISIONS.md #299 giai đoạn 2).
 * Đúng thứ tự của luồng thật: tạo kết quả NHÁP → thêm ảnh → KÝ (trigger DB chặn thêm ảnh vào kết quả đã ký). Dùng client có quyền cao (`privileged`) nên bỏ qua RLS.
 */
export interface SeedClsImage {
  storageKey: string;
  fileName?: string;
  contentType?: string;
  sizeBytes?: number;
  createdBy?: string;
}

export interface SeedClsResultOptions {
  tenantId: string;
  branchId: string;
  patientId: string;
  serviceName: string;
  serviceKind?: 'LAB' | 'IMAGING' | 'FUNCTIONAL';
  images: SeedClsImage[];
  /** Mặc định `true`: ký kết quả. `false` để lại bản nháp (chưa duyệt). */
  signed?: boolean;
}

export interface SeededClsResult {
  encounterId: string;
  orderItemId: string;
  resultId: string;
  imageIds: string[];
}

export async function seedClsResult(prisma: PrismaClient, opts: SeedClsResultOptions): Promise<SeededClsResult> {
  const suffix = Math.floor(Math.random() * 1_000_000_000);
  const department = await prisma.department.findFirstOrThrow({ where: { tenantId: opts.tenantId, isDefault: true } });
  const service = await prisma.technicalService.create({
    data: {
      tenantId: opts.tenantId,
      code: `DV-${suffix}`,
      name: opts.serviceName,
      serviceKind: opts.serviceKind ?? 'IMAGING',
      createdBy: SYSTEM_TEST_ACTOR,
      updatedBy: SYSTEM_TEST_ACTOR,
    },
  });
  const encounter = await prisma.encounter.create({
    data: {
      tenantId: opts.tenantId,
      branchId: opts.branchId,
      patientId: opts.patientId,
      departmentId: department.id,
      encounterNo: `DOC-${suffix}`,
      status: 'COMPLETED',
      checkedInAt: new Date(),
      insuranceSnapshot: { selfPay: true },
      createdBy: SYSTEM_TEST_ACTOR,
      updatedBy: SYSTEM_TEST_ACTOR,
    },
  });
  const order = await prisma.clinicalOrder.create({
    data: { tenantId: opts.tenantId, orderNo: `DOC-${suffix}`, encounterId: encounter.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
  });
  const item = await prisma.clinicalOrderItem.create({
    data: {
      tenantId: opts.tenantId,
      clinicalOrderId: order.id,
      itemKind: 'TECHNICAL_SERVICE',
      technicalServiceId: service.id,
      name: opts.serviceName,
      performance: 'IN_HOUSE',
      unitPrice: 100_000n,
      priceTypeCode: 'THUONG',
      unitCode: 'LUOT',
      status: opts.signed === false ? 'IN_PROGRESS' : 'COMPLETED',
      createdBy: SYSTEM_TEST_ACTOR,
      updatedBy: SYSTEM_TEST_ACTOR,
    },
  });
  const result = await prisma.paraclinicalResult.create({
    data: { tenantId: opts.tenantId, clinicalOrderItemId: item.id, resultedAt: new Date(), createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
  });
  const imageIds: string[] = [];
  for (const [index, image] of opts.images.entries()) {
    const created = await prisma.paraclinicalResultImage.create({
      data: {
        tenantId: opts.tenantId,
        resultId: result.id,
        storageKey: image.storageKey,
        fileName: image.fileName ?? `anh-${index + 1}.jpg`,
        contentType: image.contentType ?? 'image/jpeg',
        sizeBytes: image.sizeBytes ?? 1234,
        sortOrder: index,
        createdBy: image.createdBy ?? SYSTEM_TEST_ACTOR,
        updatedBy: image.createdBy ?? SYSTEM_TEST_ACTOR,
      },
    });
    imageIds.push(created.id);
  }
  if (opts.signed !== false) {
    await prisma.paraclinicalResult.update({ where: { id: result.id }, data: { signedAt: new Date(), signedBy: SYSTEM_TEST_ACTOR } });
  }
  return { encounterId: encounter.id, orderItemId: item.id, resultId: result.id, imageIds };
}
