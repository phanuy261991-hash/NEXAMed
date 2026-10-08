import { Injectable } from '@nestjs/common';
import { evaluateLabValue, formatLabReferenceText, type MedicalRecordParaclinicalResult, type ParaclinicalResultsReaderPort } from '@nexamed/core';
import type { ParaclinicalReference } from '@nexamed/shared';
import { UnitOfWorkService } from '../persistence/unit-of-work.service';
import { ParaclinicalResultRepository } from '../../modules/paraclinical-result/paraclinical-result.repository';
import { toReferenceRow } from '../../modules/paraclinical-result/paraclinical-result.service';

const blank = (v: string | null | undefined): boolean => v === null || v === undefined || v.trim() === '';

/**
 * Adapter thật cho `ParaclinicalResultsReaderPort` — đọc kết quả ĐÃ KÝ qua `ParaclinicalResultRepository` (module `paraclinical-result`), tự mở transaction riêng qua
 * `UnitOfWorkService` (port chỉ nhận `tenantId`, cùng khuôn `StockAvailabilityAdapter`). Bản đã duyệt dùng nguyên tên/đơn vị/khoảng tham chiếu ĐÃ CHỤP LẠI lúc lưu nên
 * bệnh án in ra không đổi dù danh mục bị sửa sau đó. Đăng ký ở `ParaclinicalResultsReaderModule` (`@Global()`) — KHÔNG ở `PortsModule` (module đó không phụ thuộc module nghiệp vụ).
 */
@Injectable()
export class ParaclinicalResultsReaderAdapter implements ParaclinicalResultsReaderPort {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly resultRepository: ParaclinicalResultRepository,
  ) {}

  async listSignedForEncounters(tenantId: string, encounterIds: string[]): Promise<Record<string, MedicalRecordParaclinicalResult[]>> {
    const rows = await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.resultRepository.listSignedByEncounterIds(tx, tenantId, encounterIds));
    const ordered = [...rows].sort((a, b) => a.orderItem.sortOrder - b.orderItem.sortOrder || a.orderItem.createdAt.getTime() - b.orderItem.createdAt.getTime());

    const byEncounter: Record<string, MedicalRecordParaclinicalResult[]> = {};
    for (const r of ordered) {
      const serviceKind = r.orderItem.technicalService?.serviceKind;
      if (!serviceKind || !r.signedAt) continue;
      const entry: MedicalRecordParaclinicalResult = {
        serviceName: r.orderItem.name,
        serviceKind,
        signedAt: r.signedAt.toISOString(),
        indicators: r.values.map((v) => {
          const row = v.referenceSnapshot ? toReferenceRow(v.referenceSnapshot as unknown as ParaclinicalReference) : null;
          const flag = !blank(v.valueText) ? evaluateLabValue(v.valueType, v.valueText as string, row) : null;
          return {
            name: v.abbreviation ? `${v.indicatorName} (${v.abbreviation})` : v.indicatorName,
            valueText: v.valueText,
            referenceText: formatLabReferenceText(row, v.decimals),
            unit: v.unit,
            abnormal: flag === 'HIGH' || flag === 'LOW' || flag === 'ABNORMAL',
          };
        }),
        descriptionText: blank(r.descriptionText) ? null : (r.descriptionText as string).trim(),
        conclusionText: blank(r.conclusionText) ? null : (r.conclusionText as string).trim(),
        imageCount: r._count.images,
      };
      (byEncounter[r.orderItem.order.encounterId] ??= []).push(entry);
    }
    return byEncounter;
  }
}
