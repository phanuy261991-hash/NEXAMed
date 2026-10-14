import { Injectable } from '@nestjs/common';
import {
  deriveOrderRowPayment,
  deriveOrderRowProgress,
  getVietnamDateString,
  stripVietnameseDiacritics,
  vietnamDayRange,
  type OrderListItemStatus,
} from '@nexamed/core';
import { calculateAgeYears, type DataScope, type ListClinicalOrdersQuery, type ListClinicalOrdersResponse } from '@nexamed/shared';
import { findAllPermissionsForUser } from '../../infrastructure/persistence/permission-lookup.helper';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { DiagnosisRepository } from '../encounter/diagnosis.repository';
import { UserAccountRepository } from '../iam/user-account.repository';
import { ClinicalOrderRepository } from './clinical-order.repository';

/**
 * Menu "Phiếu chỉ định" (Cận lâm sàng, docs/DECISIONS.md #232) — sổ tra cứu MỌI phiếu chỉ định theo ngày, chia nhóm Xét nghiệm / CĐHA & Thăm dò chức năng / Chỉ định ra ngoài.
 * Dữ liệu THEO CHI NHÁNH (kế thừa chi nhánh của lượt khám): chỉ phiếu của chi nhánh đang làm việc. Chỉ đọc — thực hiện, nhập kết quả, thu tiền ở các menu khác.
 */
@Injectable()
export class ClinicalOrderBookService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly repository: ClinicalOrderRepository,
    private readonly userRepository: UserAccountRepository,
    private readonly diagnosisRepository: DiagnosisRepository,
  ) {}

  async list(tenantId: string, branchId: string, actorId: string, dataScope: DataScope, query: ListClinicalOrdersQuery): Promise<ListClinicalOrdersResponse> {
    const today = getVietnamDateString();
    let fromDate = query.dateFrom ?? query.dateTo ?? today;
    let toDate = query.dateTo ?? query.dateFrom ?? today;
    if (fromDate > toDate) [fromDate, toDate] = [toDate, fromDate];
    const from = vietnamDayRange(fromDate).startUtc;
    const to = vietnamDayRange(toDate).endUtc;
    const q = query.q?.trim();
    // Scope `personal` (vai trò tuỳ biến): chỉ thấy phiếu của lượt khám do chính mình phụ trách; các scope còn lại thấy cả chi nhánh.
    const doctorId = dataScope === 'personal' ? actorId : query.doctorId;

    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const rows = await this.repository.listForBook(tx, tenantId, branchId, {
        group: query.group,
        from,
        to,
        doctorId,
        progress: query.progress,
        search: q ? { raw: q, normalized: stripVietnameseDiacritics(q).toLowerCase() } : undefined,
        cursor: query.cursor,
        limit: query.limit,
      });
      const hasMore = rows.length > query.limit;
      const page = hasMore ? rows.slice(0, query.limit) : rows;

      // Chẩn đoán là dữ liệu lâm sàng: chỉ gửi khi actor có `encounter.read_clinical` (lễ tân/thu ngân không có).
      const permissions = await findAllPermissionsForUser(tx, tenantId, actorId);
      const diagnoses = 'encounter.read_clinical' in permissions ? await this.diagnosisRepository.listForEncounters(tx, tenantId, page.map((o) => o.encounter.id)) : null;

      const doctorIds = [...new Set(page.map((r) => r.encounter.doctorId).filter((id): id is string => id !== null))];
      const doctorNames = new Map((await this.userRepository.findFullNamesByIds(tx, tenantId, doctorIds)).map((u) => [u.id, u.fullName]));

      const items = page.map((order) => {
        const statuses = order.items.map((i) => i.status as OrderListItemStatus);
        const patient = order.encounter.patient;
        const live = order.items.filter((i) => i.status !== 'CANCELLED');
        const named = live.length > 0 ? live : order.items;
        return {
          orderId: order.id,
          orderNo: order.orderNo,
          encounterId: order.encounter.id,
          encounterNo: order.encounter.encounterNo ?? null,
          patientId: patient.id,
          patientName: patient.fullName,
          patientCode: patient.patientCode,
          patientDob: patient.dob.toISOString().slice(0, 10),
          patientGender: patient.gender,
          patientPhone: patient.phone || null,
          ageYears: calculateAgeYears(patient.dob.toISOString()),
          doctorName: order.encounter.doctorId ? (doctorNames.get(order.encounter.doctorId) ?? null) : null,
          primaryDiagnosis: (() => {
            const primary = diagnoses?.get(order.encounter.id)?.find((d) => d.type === 'PRIMARY');
            return primary ? { code: primary.icd10Code, name: primary.icd10.nameVi } : null;
          })(),
          orderedAt: order.createdAt.toISOString(),
          serviceNames: named.map((i) => i.name),
          // Đếm theo dịch vụ còn hiệu lực; phiếu đã huỷ hết thì đếm các dịch vụ đã chỉ định (không hiện "0 dịch vụ").
          serviceCount: named.length,
          progress: deriveOrderRowProgress(query.group, statuses),
          payment: deriveOrderRowPayment(
            query.group,
            order.items.map((i) => ({
              status: i.status as OrderListItemStatus,
              // Dòng lẻ: hoá đơn của chính nó; dòng thuộc gói: hoá đơn của gói chứa nó.
              invoiceStatuses: (i.clinicalOrderPackageId === null ? i.invoiceLines : (i.package?.invoiceLines ?? [])).map((l) => l.invoice.status),
            })),
          ),
        };
      });

      return { items, nextCursor: hasMore ? page[page.length - 1]!.id : null };
    });
  }
}
