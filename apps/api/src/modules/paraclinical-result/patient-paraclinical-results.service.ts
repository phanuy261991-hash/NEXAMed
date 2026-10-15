import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  BRANCH_DIRECTORY_PORT,
  countTrackableIndicators,
  evaluateLabValue,
  formatLabReferenceText,
  groupIndicatorMeasures,
  indicatorKey,
  isAbnormalFlag,
  normalizeIndicatorUnit,
  parseLabNumber,
  stripVietnameseDiacritics,
  vietnamDayRange,
  type BranchDirectoryPort,
  type IndicatorMeasure,
} from '@nexamed/core';
import type {
  ListPatientIndicatorsResponse,
  ListPatientParaclinicalResultsQuery,
  ListPatientParaclinicalResultsResponse,
  ParaclinicalReference,
  ParaclinicalResultForm,
  ParaclinicalValueFlag,
  PatientIndicatorTrendQuery,
  PatientIndicatorTrendResponse,
  PatientParaclinicalAbnormal,
  PatientParaclinicalResultRow,
} from '@nexamed/shared';
import type { RequestMeta } from '../../common/request-meta';
import { findAllPermissionsForUser } from '../../infrastructure/persistence/permission-lookup.helper';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { UserAccountRepository } from '../iam/user-account.repository';
import { ReferenceCatalogRepository } from '../reference-catalog/reference-catalog.repository';
import { ParaclinicalResultRepository } from './paraclinical-result.repository';
import { ParaclinicalResultService, toReferenceRow, type ResultAccessScope } from './paraclinical-result.service';

type SignedRow = Awaited<ReturnType<ParaclinicalResultRepository['listSignedForPatient']>>[number];

const CONCLUSION_PREVIEW_CHARS = 200;
const blank = (v: string | null | undefined): boolean => v === null || v === undefined || v.trim() === '';

/** Lượt đo số của một chỉ số, kèm đủ dữ liệu để dựng danh sách và biểu đồ. */
interface NumericMeasure extends IndicatorMeasure {
  itemId: string;
  orderNo: string;
  valueText: string;
  flag: ParaclinicalValueFlag | null;
  reference: ParaclinicalReference | null;
  decimals: number | null;
  branchId: string;
}

/** Một dòng kết quả đã được đánh giá — dùng chung cho danh sách, dải số và diễn biến chỉ số. */
interface EvaluatedResult {
  row: SignedRow;
  abnormals: PatientParaclinicalAbnormal[];
  evaluatedCount: number;
  categoryName: string | null;
  measures: NumericMeasure[];
}

/**
 * Tab "Kết quả cận lâm sàng" ở Hồ sơ bệnh nhân (docs/DECISIONS.md #234, mockup đã duyệt 14/10/2026): kết quả ĐÃ DUYỆT theo BỆNH NHÂN, mọi chi nhánh (kết quả đi theo người bệnh — như
 * tab Lịch sử khám; tab này không có số tiền nên không có gì phải che), cùng diễn biến từng chỉ số xét nghiệm. Quyền theo nhóm (`lab_result.read` / `imaging_result.read`), scope
 * `department` giới hạn theo Khoa/Phòng thực hiện dịch vụ. Chỉ ĐỌC: không sinh dữ liệu mới. Mở/in từng kết quả đi qua `ParaclinicalResultService` với `crossBranchPatientId`.
 */
@Injectable()
export class PatientParaclinicalResultsService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly resultRepository: ParaclinicalResultRepository,
    private readonly userRepository: UserAccountRepository,
    private readonly referenceCatalogRepository: ReferenceCatalogRepository,
    private readonly resultService: ParaclinicalResultService,
    @Inject(BRANCH_DIRECTORY_PORT) private readonly branchDirectory: BranchDirectoryPort,
  ) {}

  async list(tenantId: string, actorId: string, scope: ResultAccessScope, patientId: string, query: ListPatientParaclinicalResultsQuery): Promise<ListPatientParaclinicalResultsResponse> {
    await this.assertCanSeeContent(tenantId, actorId, scope);
    const isLab = scope.kinds.includes('LAB');
    const [loaded, branchNames, multiBranch] = await Promise.all([this.load(tenantId, actorId, scope, patientId), this.branchDirectory.getBranchNames(tenantId), this.branchDirectory.isMultiBranch(tenantId)]);
    const { evaluated, signerNames, doctorNames } = loaded;

    const filtered = evaluated.filter((e) => this.matches(e, query, isLab));
    const offset = parseCursor(query.cursor);
    const page = filtered.slice(offset, offset + query.limit);

    const items: PatientParaclinicalResultRow[] = page.map((e) => {
      const r = e.row;
      const encounter = r.orderItem.order.encounter;
      return {
        itemId: r.orderItem.id,
        orderNo: r.orderItem.order.orderNo,
        encounterId: encounter.id,
        encounterNo: encounter.encounterNo,
        serviceName: r.orderItem.name,
        categoryName: e.categoryName,
        signedAt: r.signedAt!.toISOString(),
        signedByName: r.signedBy ? (signerNames.get(r.signedBy) ?? null) : null,
        doctorName: encounter.doctorId ? (doctorNames.get(encounter.doctorId) ?? null) : null,
        status: r.supersedesId !== null ? 'AMENDED' : 'APPROVED',
        abnormals: e.abnormals,
        evaluatedCount: e.evaluatedCount,
        conclusionText: isLab || blank(r.conclusionText) ? null : truncate((r.conclusionText as string).trim()),
        imageCount: r._count.images,
        branchId: encounter.branchId,
        branchName: branchNames.get(encounter.branchId) ?? null,
        isOtherBranch: encounter.branchId !== scope.branchId,
      };
    });

    return {
      items,
      nextCursor: offset + query.limit < filtered.length ? String(offset + query.limit) : null,
      summary: this.summarize(evaluated, isLab),
      multiBranch,
    };
  }

  /** Danh sách chỉ số dạng số theo dõi được (xét nghiệm). Mỗi mục = một mã chỉ số + một đơn vị. */
  async listIndicators(tenantId: string, actorId: string, scope: ResultAccessScope, patientId: string): Promise<ListPatientIndicatorsResponse> {
    await this.assertCanSeeContent(tenantId, actorId, scope);
    const { evaluated } = await this.load(tenantId, actorId, scope, patientId);
    const groups = groupIndicatorMeasures(evaluated.flatMap((e) => e.measures));
    return {
      items: groups.map((g) => {
        const latest = g.measures[g.measures.length - 1]!;
        return {
          code: g.code,
          unit: g.unit,
          name: g.name,
          groupName: g.groupName,
          measureCount: g.measures.length,
          latestValue: latest.value,
          latestValueText: latest.valueText,
          latestFlag: latest.flag,
          latestSignedAt: new Date(latest.signedAtMs).toISOString(),
        };
      }),
    };
  }

  async indicatorTrend(tenantId: string, actorId: string, scope: ResultAccessScope, patientId: string, query: PatientIndicatorTrendQuery): Promise<PatientIndicatorTrendResponse> {
    await this.assertCanSeeContent(tenantId, actorId, scope);
    const [loaded, branchNames, multiBranch] = await Promise.all([this.load(tenantId, actorId, scope, patientId), this.branchDirectory.getBranchNames(tenantId), this.branchDirectory.isMultiBranch(tenantId)]);
    const wanted = indicatorKey(query.code, query.unit);
    const group = groupIndicatorMeasures(loaded.evaluated.flatMap((e) => e.measures)).find((g) => indicatorKey(g.code, g.unit) === wanted);
    if (!group) throw new NotFoundException();
    return {
      code: group.code,
      unit: group.unit,
      name: group.name,
      multiBranch,
      points: group.measures.map((m) => {
        const row = m.reference ? toReferenceRow(m.reference) : null;
        return {
          itemId: m.itemId,
          orderNo: m.orderNo,
          signedAt: new Date(m.signedAtMs).toISOString(),
          value: m.value,
          valueText: m.valueText,
          flag: m.flag,
          referenceText: formatLabReferenceText(row, m.decimals),
          low: m.reference?.lowValue ?? null,
          high: m.reference?.highValue ?? null,
          branchName: branchNames.get(m.branchId) ?? null,
          isOtherBranch: m.branchId !== scope.branchId,
        };
      }),
    };
  }

  /** Mở một kết quả (đã duyệt) của bệnh nhân này, ở bất kỳ chi nhánh nào. Dòng không thuộc bệnh nhân / chưa duyệt / ngoài nhóm quyền → 404. */
  async getForm(tenantId: string, actorId: string, scope: ResultAccessScope, patientId: string, itemId: string): Promise<ParaclinicalResultForm> {
    await this.assertCanSeeContent(tenantId, actorId, scope);
    return this.resultService.getForm(tenantId, actorId, { ...scope, crossBranchPatientId: patientId }, itemId);
  }

  async recordPrint(tenantId: string, actorId: string, scope: ResultAccessScope, patientId: string, itemId: string, meta: RequestMeta): Promise<void> {
    await this.assertCanSeeContent(tenantId, actorId, scope);
    return this.resultService.recordPrint(tenantId, actorId, { ...scope, crossBranchPatientId: patientId }, itemId, meta);
  }

  // ---------------------------------------------------------------------------------------------

  /**
   * Chỉ người làm chuyên môn của nhóm — có quyền Nhập hoặc Duyệt (kỹ thuật viên, điều dưỡng, bác sĩ, quản lý) — xem được NỘI DUNG kết quả theo bệnh nhân. Lễ tân chỉ có quyền Xem nên
   * chỉ thấy danh sách ở menu "Tra cứu kết quả" (chủ dự án chốt 13/10/2026, #232); tab này không dành cho họ, kiểm ở máy chủ chứ không chỉ ẩn ở giao diện.
   */
  private async assertCanSeeContent(tenantId: string, actorId: string, scope: ResultAccessScope): Promise<void> {
    const permissions = await this.unitOfWork.runInTenantScope(tenantId, (tx) => findAllPermissionsForUser(tx, tenantId, actorId));
    if (!(`${scope.permissionModule}.enter` in permissions) && !(`${scope.permissionModule}.approve` in permissions)) {
      throw new ForbiddenException('Tài khoản chỉ có quyền xem danh sách kết quả — không xem được nội dung kết quả của bệnh nhân.');
    }
  }

  private async load(tenantId: string, actorId: string, scope: ResultAccessScope, patientId: string) {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      let departmentId: string | undefined;
      if (scope.dataScope === 'department') {
        const own = await this.userRepository.findDepartmentId(tx, tenantId, actorId);
        // Scope `department` mà tài khoản chưa gán Khoa/Phòng → không thấy gì (không lỗi), cùng cách hàng đợi và Tra cứu kết quả.
        if (own === null) return { evaluated: [] as EvaluatedResult[], signerNames: new Map<string, string>(), doctorNames: new Map<string, string>() };
        departmentId = own;
      }
      const rows = await this.resultRepository.listSignedForPatient(tx, tenantId, patientId, { kinds: scope.kinds as ('LAB' | 'IMAGING' | 'FUNCTIONAL')[], departmentId });
      const categories = new Map((await this.referenceCatalogRepository.listByCategories(tx, tenantId, ['TECH_SERVICE_CATEGORY'])).map((c) => [c.code, c.name]));
      const userIds = new Set<string>();
      for (const r of rows) {
        if (r.signedBy) userIds.add(r.signedBy);
        const doctorId = r.orderItem.order.encounter.doctorId;
        if (doctorId) userIds.add(doctorId);
      }
      const names = new Map((await this.userRepository.findFullNamesByIds(tx, tenantId, [...userIds])).map((u) => [u.id, u.fullName]));
      return { evaluated: rows.map((row) => this.evaluate(row, categories)), signerNames: names, doctorNames: names };
    });
  }

  private evaluate(row: SignedRow, categories: Map<string, string>): EvaluatedResult {
    const categoryCode = row.orderItem.technicalService?.categoryCode ?? null;
    const categoryName = categoryCode ? (categories.get(categoryCode) ?? null) : null;
    const abnormals: PatientParaclinicalAbnormal[] = [];
    const measures: NumericMeasure[] = [];
    let evaluatedCount = 0;
    for (const v of row.values) {
      if (blank(v.valueText)) continue;
      const reference = (v.referenceSnapshot as ParaclinicalReference | null) ?? null;
      const flag = evaluateLabValue(v.valueType, v.valueText as string, reference ? toReferenceRow(reference) : null);
      if (flag !== null) evaluatedCount += 1;
      if (flag !== null && isAbnormalFlag(flag)) {
        abnormals.push({ label: v.abbreviation ?? v.indicatorName, valueText: (v.valueText as string).trim(), unit: normalizeIndicatorUnit(v.unit), flag });
      }
      if (v.valueType === 'NUMBER') {
        const value = parseLabNumber(v.valueText as string);
        if (value !== null) {
          measures.push({
            code: v.indicatorCode,
            unit: normalizeIndicatorUnit(v.unit),
            name: v.indicatorName,
            groupName: categoryName,
            signedAtMs: row.signedAt!.getTime(),
            value,
            itemId: row.orderItem.id,
            orderNo: row.orderItem.order.orderNo,
            valueText: (v.valueText as string).trim(),
            flag,
            reference,
            decimals: v.decimals,
            branchId: row.orderItem.order.encounter.branchId,
          });
        }
      }
    }
    return { row, abnormals, evaluatedCount, categoryName, measures };
  }

  private matches(e: EvaluatedResult, query: ListPatientParaclinicalResultsQuery, isLab: boolean): boolean {
    const signedAt = e.row.signedAt!;
    if (query.dateFrom && signedAt < vietnamDayRange(query.dateFrom).startUtc) return false;
    if (query.dateTo && signedAt >= vietnamDayRange(query.dateTo).endUtc) return false;
    if (query.status === 'AMENDED' && e.row.supersedesId === null) return false;
    if (query.status === 'APPROVED' && e.row.supersedesId !== null) return false;
    if (isLab && query.abnormalOnly && e.abnormals.length === 0) return false;
    const q = query.q?.trim();
    if (q) {
      const needle = stripVietnameseDiacritics(q).toLowerCase();
      const hay = stripVietnameseDiacritics(`${e.row.orderItem.name} ${e.row.orderItem.order.orderNo} ${e.categoryName ?? ''}`).toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  }

  private summarize(evaluated: EvaluatedResult[], isLab: boolean): ListPatientParaclinicalResultsResponse['summary'] {
    const latest = evaluated[0];
    const oldest = evaluated[evaluated.length - 1];
    const byCategory = new Map<string, number>();
    if (!isLab) {
      for (const e of evaluated) byCategory.set(e.categoryName ?? 'Khác', (byCategory.get(e.categoryName ?? 'Khác') ?? 0) + 1);
    }
    return {
      totalApproved: evaluated.length,
      firstSignedAt: oldest ? oldest.row.signedAt!.toISOString() : null,
      latestSignedAt: latest ? latest.row.signedAt!.toISOString() : null,
      // Dịch vụ của PHIẾU mới nhất (cùng mã phiếu với dòng đầu), tối đa 3 tên, bỏ trùng.
      latestServiceNames: latest ? [...new Set(evaluated.filter((e) => e.row.orderItem.order.orderNo === latest.row.orderItem.order.orderNo).map((e) => e.row.orderItem.name))].slice(0, 3) : [],
      abnormalResults: isLab ? evaluated.filter((e) => e.abnormals.length > 0).length : 0,
      trackableIndicators: isLab ? countTrackableIndicators(groupIndicatorMeasures(evaluated.flatMap((e) => e.measures))) : 0,
      byCategory: [...byCategory.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'vi')),
    };
  }
}

function parseCursor(cursor: string | undefined): number {
  const n = cursor ? Number.parseInt(cursor, 10) : 0;
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function truncate(text: string): string {
  return text.length > CONCLUSION_PREVIEW_CHARS ? `${text.slice(0, CONCLUSION_PREVIEW_CHARS - 1)}…` : text;
}
