import { Injectable } from '@nestjs/common';
import { evaluateLabValue, formatLabReferenceText, type MedicalRecordDeclinedItem, type MedicalRecordParaclinicalResult, type MedicalRecordPdfFileRef, type ParaclinicalResultsReaderPort } from '@nexamed/core';
import type { ParaclinicalReference } from '@nexamed/shared';
import { UnitOfWorkService } from '../persistence/unit-of-work.service';
import { ClinicalOrderRepository } from '../../modules/clinical-order/clinical-order.repository';
import { ParaclinicalResultRepository } from '../../modules/paraclinical-result/paraclinical-result.repository';
import { toReferenceRow } from '../../modules/paraclinical-result/paraclinical-result.service';

const blank = (v: string | null | undefined): boolean => v === null || v === undefined || v.trim() === '';
const isPdf = (contentType: string): boolean => contentType.toLowerCase() === 'application/pdf';

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
    private readonly orderRepository: ClinicalOrderRepository,
  ) {}

  async listDeclinedForEncounters(tenantId: string, encounterIds: string[]): Promise<Record<string, MedicalRecordDeclinedItem[]>> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const rows = await this.orderRepository.listDeclinedByEncounterIds(tx, tenantId, encounterIds);
      if (rows.length === 0) return {};
      const names = await this.orderRepository.findDeclineNames(
        tx,
        tenantId,
        [...new Set(rows.map((r) => r.declineReasonCode).filter((v): v is string => v !== null))],
        [...new Set(rows.map((r) => r.declinedBy).filter((v): v is string => v !== null))],
      );
      const byEncounter: Record<string, MedicalRecordDeclinedItem[]> = {};
      for (const r of rows) {
        if (r.declinedAt === null) continue;
        (byEncounter[r.order.encounterId] ??= []).push({
          orderItemId: r.id,
          serviceName: r.name,
          // Mã không còn trong danh mục (đã ẩn/đổi) → in chính mã, không để mất lý do khỏi hồ sơ.
          reasonLabel: r.declineReasonCode === null ? '—' : (names.reasons.get(r.declineReasonCode) ?? r.declineReasonCode),
          note: r.declineNote,
          declinedAt: r.declinedAt.toISOString(),
          declinedByName: r.declinedBy === null ? null : (names.users.get(r.declinedBy) ?? null),
        });
      }
      return byEncounter;
    });
  }

  async listSignedPdfFilesForEncounters(tenantId: string, encounterIds: string[]): Promise<Record<string, MedicalRecordPdfFileRef[]>> {
    const rows = await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.resultRepository.listSignedByEncounterIds(tx, tenantId, encounterIds));
    const ordered = [...rows].sort((a, b) => a.orderItem.sortOrder - b.orderItem.sortOrder || a.orderItem.createdAt.getTime() - b.orderItem.createdAt.getTime());
    const byEncounter: Record<string, MedicalRecordPdfFileRef[]> = {};
    for (const r of ordered) {
      if (!r.signedAt) continue;
      const list = (byEncounter[r.orderItem.order.encounterId] ??= []);
      for (const image of r.images.filter((i) => isPdf(i.contentType))) {
        // Một tệp PDF có thể gắn cho nhiều dịch vụ (một lần nhận kết quả): ghép MỘT lần, nhớ các dịch vụ dùng chung.
        const existing = list.find((f) => f.storageKey === image.storageKey);
        if (existing) existing.itemIds.push(r.orderItem.id);
        else list.push({ storageKey: image.storageKey, fileName: image.fileName, itemIds: [r.orderItem.id] });
      }
    }
    return byEncounter;
  }

  async listSignedForEncounters(tenantId: string, encounterIds: string[]): Promise<Record<string, MedicalRecordParaclinicalResult[]>> {
    const rows = await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.resultRepository.listSignedByEncounterIds(tx, tenantId, encounterIds));
    const ordered = [...rows].sort((a, b) => a.orderItem.sortOrder - b.orderItem.sortOrder || a.orderItem.createdAt.getTime() - b.orderItem.createdAt.getTime());

    const byEncounter: Record<string, MedicalRecordParaclinicalResult[]> = {};
    for (const r of ordered) {
      const serviceKind = r.orderItem.technicalService?.serviceKind;
      if (!serviceKind || !r.signedAt) continue;
      const entry: MedicalRecordParaclinicalResult = {
        itemId: r.orderItem.id,
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
        imageCount: r.images.filter((i) => !isPdf(i.contentType)).length,
        pdfCount: r.images.filter((i) => isPdf(i.contentType)).length,
      };
      (byEncounter[r.orderItem.order.encounterId] ??= []).push(entry);
    }
    return byEncounter;
  }
}
