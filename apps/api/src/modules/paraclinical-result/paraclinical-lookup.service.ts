import { Injectable } from '@nestjs/common';
import { evaluateLabValue, isAbnormalFlag, resolveRecentDateRange, stripVietnameseDiacritics, summarizeLookupResult } from '@nexamed/core';
import { calculateAgeYears, type ListParaclinicalLookupQuery, type ListParaclinicalLookupResponse, type ParaclinicalLookupRow, type ParaclinicalReference } from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { ClinicalOrderRepository, type LookupOrderRow } from '../clinical-order/clinical-order.repository';
import { UserAccountRepository } from '../iam/user-account.repository';
import { toGender } from './paraclinical-item.helpers';
import { toReferenceRow, type ResultAccessScope } from './paraclinical-result.service';

/** Số lần lấy thêm tối đa khi bộ lọc "chỉ chỉ số bất thường" loại bớt dòng — chặn vòng lặp dài trên dữ liệu rất lớn. */
const MAX_BATCHES = 8;

type LookupItem = LookupOrderRow['items'][number];

/** Dịch vụ đã thu tiền: dòng hoá đơn của chính nó (lẻ) hoặc của gói chứa nó, mọi dòng đều trên hoá đơn đã thu. Cùng quy tắc `isPaid` của hàng đợi. */
function itemPaid(item: LookupItem): boolean {
  const lines = item.clinicalOrderPackageId === null ? item.invoiceLines : (item.package?.invoiceLines ?? []);
  return lines.length > 0 && lines.every((l) => l.invoice.status === 'PAID');
}

/**
 * Menu "Tra cứu kết quả" (Cận lâm sàng, docs/DECISIONS.md #232) — kết quả ĐÃ DUYỆT theo khoảng ngày, để xem + in lại. Mỗi nhóm menu (Xét nghiệm / CĐHA & Thăm dò chức năng) có quyền
 * riêng và chỉ thấy đúng loại dịch vụ của mình; scope `department` chỉ thấy dịch vụ do Khoa/Phòng mình thực hiện. THEO CHI NHÁNH: chỉ lượt khám của chi nhánh đang làm việc.
 * Xét nghiệm: 1 dòng/phiếu (cùng tình trạng thu tiền — khớp cách gộp của màn nhập kết quả); CĐHA & thăm dò: 1 dòng/dịch vụ.
 */
@Injectable()
export class ParaclinicalLookupService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly orderRepository: ClinicalOrderRepository,
    private readonly userRepository: UserAccountRepository,
  ) {}

  async list(tenantId: string, actorId: string, scope: ResultAccessScope, query: ListParaclinicalLookupQuery): Promise<ListParaclinicalLookupResponse> {
    // Mặc định 7 ngày gần nhất (hôm nay + 6 ngày trước).
    const { from, to } = resolveRecentDateRange(query.dateFrom, query.dateTo, 6);
    const q = query.q?.trim();
    const isLab = scope.kinds.includes('LAB');

    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      let departmentId: string | undefined;
      if (scope.dataScope === 'department') {
        const own = await this.userRepository.findDepartmentId(tx, tenantId, actorId);
        // Scope `department` mà tài khoản chưa gán Khoa/Phòng → không khớp phòng nào → danh sách rỗng (không lỗi), cùng cách hàng đợi.
        if (own === null) return { items: [], nextCursor: null };
        departmentId = own;
      }

      const rows: ParaclinicalLookupRow[] = [];
      let cursor = query.cursor;
      let nextCursor: string | null = null;
      for (let batch = 0; batch < MAX_BATCHES && rows.length < query.limit; batch += 1) {
        const orders = await this.orderRepository.listForLookup(tx, tenantId, scope.branchId, {
          kinds: scope.kinds as ('LAB' | 'IMAGING' | 'FUNCTIONAL')[],
          from,
          to,
          status: query.status,
          departmentId,
          search: q ? { raw: q, normalized: stripVietnameseDiacritics(q).toLowerCase() } : undefined,
          cursor,
          limit: query.limit,
        });
        const hasMore = orders.length > query.limit;
        const page = hasMore ? orders.slice(0, query.limit) : orders;
        rows.push(...(await this.toRows(tx, tenantId, page, isLab, query.abnormalOnly)));
        nextCursor = hasMore ? page[page.length - 1]!.id : null;
        if (!hasMore) break;
        cursor = nextCursor ?? undefined;
      }
      return { items: rows, nextCursor };
    });
  }

  private async toRows(tx: Parameters<Parameters<UnitOfWorkService['runInTenantScope']>[1]>[0], tenantId: string, orders: LookupOrderRow[], isLab: boolean, abnormalOnly: boolean): Promise<ParaclinicalLookupRow[]> {
    const signerIds = new Set<string>();
    for (const o of orders) for (const i of o.items) for (const r of i.results) if (r.signedBy) signerIds.add(r.signedBy);
    const names = new Map((await this.userRepository.findFullNamesByIds(tx, tenantId, [...signerIds])).map((u) => [u.id, u.fullName]));

    const out: ParaclinicalLookupRow[] = [];
    for (const order of orders) {
      const patient = order.encounter.patient;
      // Xét nghiệm: gộp các dịch vụ cùng phiếu + cùng tình trạng thu tiền thành 1 dòng; CĐHA/thăm dò: mỗi dịch vụ 1 dòng.
      const groups = new Map<string, LookupItem[]>();
      for (const item of order.items) {
        const key = isLab ? `lab|${itemPaid(item) ? 1 : 0}` : item.id;
        groups.set(key, [...(groups.get(key) ?? []), item]);
      }
      for (const items of groups.values()) {
        const results = items.flatMap((i) => i.results);
        if (results.length === 0) continue;
        const latest = results.reduce((best, r) => (r.signedAt! > best.signedAt! ? r : best));
        let abnormalCount = 0;
        let evaluatedCount = 0;
        for (const r of results) {
          for (const v of r.values) {
            if (v.valueText === null || v.valueText.trim() === '') continue;
            const reference = (v.referenceSnapshot as ParaclinicalReference | null) ?? null;
            const flag = evaluateLabValue(v.valueType, v.valueText, reference ? toReferenceRow(reference) : null);
            if (flag !== null) evaluatedCount += 1;
            if (isAbnormalFlag(flag)) abnormalCount += 1;
          }
        }
        const hasConclusion = results.some((r) => r.conclusionText !== null && r.conclusionText.trim() !== '');
        const summary = summarizeLookupResult({ isLab, abnormalCount, evaluatedCount, hasConclusion });
        if (isLab && abnormalOnly && summary !== 'ABNORMAL') continue;
        out.push({
          key: items[0]!.id,
          itemIds: items.map((i) => i.id),
          orderNo: order.orderNo,
          encounterId: order.encounter.id,
          patientId: patient.id,
          patientName: patient.fullName,
          patientCode: patient.patientCode,
          ageYears: calculateAgeYears(patient.dob.toISOString()),
          gender: toGender(patient.gender),
          serviceNames: items.map((i) => i.name),
          serviceCount: items.length,
          signedAt: latest.signedAt!.toISOString(),
          signedByName: latest.signedBy ? (names.get(latest.signedBy) ?? null) : null,
          status: results.some((r) => r.supersedesId !== null) ? 'AMENDED' : 'APPROVED',
          summary,
          abnormalCount,
        });
      }
    }
    return out;
  }
}
