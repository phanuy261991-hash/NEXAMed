import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { EMPTY_INTEROP_KIND_INFO, type InteropKindInfoValue, type PrescriptionKind } from '@nexamed/shared';
import { dbDateToDateString } from './treatment-plan.repository';

/**
 * Ô bổ sung bắt buộc khi gửi đơn lên cổng Đơn thuốc quốc gia (docs/DECISIONS.md #242 GĐ3, mockup 8b) — bảng `encounter_interop_kind_info`, khoá theo (lượt khám, loại đơn C/N/H/Y).
 * Chỗ DUY NHẤT chạm bảng này. Chi nhánh kế thừa qua lượt khám (service đã kiểm lượt khám thuộc chi nhánh hiện hành trước khi gọi). Không xoá cứng; "xoá" một ô = ghi null.
 */
@Injectable()
export class EncounterInteropInfoRepository {
  async listForEncounter(tx: Prisma.TransactionClient, tenantId: string, encounterId: string): Promise<Map<PrescriptionKind, InteropKindInfoValue>> {
    const rows = await tx.encounterInteropKindInfo.findMany({ where: { tenantId, encounterId, deletedAt: null } });
    return new Map(
      rows.map((r) => [
        r.kind as PrescriptionKind,
        {
          treatmentFormCode: r.treatmentFormCode,
          dosePeriodNumber: r.dosePeriodNumber,
          doseFrom: dbDateToDateString(r.doseFrom),
          doseTo: dbDateToDateString(r.doseTo),
          herbalDoses: r.herbalDoses,
          herbalInstruction: r.herbalInstruction,
        },
      ]),
    );
  }

  /** Ghi (tạo hoặc sửa) các ô của một loại đơn. Trả `true` nếu có thay đổi so với giá trị đã lưu (để biết có cần ghi nhật ký). */
  async upsert(tx: Prisma.TransactionClient, tenantId: string, actorId: string, encounterId: string, kind: PrescriptionKind, value: InteropKindInfoValue): Promise<boolean> {
    const existing = await tx.encounterInteropKindInfo.findFirst({ where: { tenantId, encounterId, kind, deletedAt: null } });
    const data = {
      treatmentFormCode: value.treatmentFormCode,
      dosePeriodNumber: value.dosePeriodNumber,
      doseFrom: value.doseFrom ? new Date(value.doseFrom) : null,
      doseTo: value.doseTo ? new Date(value.doseTo) : null,
      herbalDoses: value.herbalDoses,
      herbalInstruction: value.herbalInstruction && value.herbalInstruction.trim() !== '' ? value.herbalInstruction.trim() : null,
    };
    if (!existing) {
      const isEmpty = JSON.stringify(value) === JSON.stringify(EMPTY_INTEROP_KIND_INFO);
      if (isEmpty) return false;
      await tx.encounterInteropKindInfo.create({ data: { tenantId, encounterId, kind, ...data, createdBy: actorId, updatedBy: actorId } });
      return true;
    }
    const same =
      existing.treatmentFormCode === data.treatmentFormCode &&
      existing.dosePeriodNumber === data.dosePeriodNumber &&
      dbDateToDateString(existing.doseFrom) === value.doseFrom &&
      dbDateToDateString(existing.doseTo) === value.doseTo &&
      existing.herbalDoses === data.herbalDoses &&
      existing.herbalInstruction === data.herbalInstruction;
    if (same) return false;
    await tx.encounterInteropKindInfo.updateMany({
      where: { tenantId, id: existing.id, deletedAt: null, version: existing.version },
      data: { ...data, updatedBy: actorId, version: { increment: 1 } },
    });
    return true;
  }
}
