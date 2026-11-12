import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  DOCTOR_DIRECTORY_PORT,
  averageCostPerVisit,
  diffDateStrings,
  isValidDateString,
  topConsumedItemNames,
  vietnamDateRangeHalfOpenUtc,
  type DoctorDirectoryPort,
} from '@nexamed/core';
import {
  SERVICE_CONSUMPTION_REPORT_ENTRY_LIMIT,
  SERVICE_CONSUMPTION_REPORT_MAX_RANGE_DAYS,
  SERVICE_CONSUMPTION_REPORT_ROW_LIMIT,
  type ServiceConsumptionByCustomerReport,
  type ServiceConsumptionByServiceReport,
  type ServiceConsumptionReportQuery,
} from '@nexamed/shared';
import { ReportBranchScopeService, type ReportBranchScope } from '../../common/report-branch-scope.service';
import { buildReportExportContext, writeReportExportAudit } from '../../common/report-export-support';
import type { RequestMeta } from '../../common/request-meta';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { ClinicProfileService } from '../clinic/clinic-profile.service';
import { ServiceConsumptionReportRepository, type ServiceConsumptionRange } from './service-consumption-report.repository';

interface Actor {
  tenantId: string;
  userId: string;
  branchId: string | null;
}

/** Số mặt hàng "dùng nhiều nhất" hiện ở mỗi dịch vụ (mockup màn 9: hai tên). */
const TOP_ITEMS_PER_SERVICE = 2;

/**
 * Báo cáo "Chi phí vật tư theo dịch vụ" (docs/DECISIONS.md #297 GĐ4, màn 9). Quyền `service_consumption.report` (mặc định chỉ quản lý phòng khám vì có giá vốn). Phạm vi chi nhánh từ
 * `ReportBranchScopeService` (#235): gộp từ hai chi nhánh trở lên cần THÊM `company_report.read`. Một request = MỘT transaction: phạm vi đọc TRƯỚC khi mở transaction, tên bác sĩ/người thực hiện
 * đọc qua port SAU khi transaction đóng (các port tự mở kết nối riêng, #264). Chi phí KHÔNG vào lãi gộp.
 */
@Injectable()
export class ServiceConsumptionReportService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly repository: ServiceConsumptionReportRepository,
    private readonly reportBranchScope: ReportBranchScopeService,
    private readonly clinicProfileService: ClinicProfileService,
    @Inject(DOCTOR_DIRECTORY_PORT) private readonly doctorDirectory: DoctorDirectoryPort,
  ) {}

  /** Kiểm khoảng ngày rồi giải quyết phạm vi chi nhánh. */
  private async resolve(actor: Actor, query: ServiceConsumptionReportQuery): Promise<{ range: ServiceConsumptionRange; scope: ReportBranchScope }> {
    if (!isValidDateString(query.from) || !isValidDateString(query.to)) throw new BadRequestException('Ngày không hợp lệ.');
    if (query.from > query.to) throw new BadRequestException('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.');
    const span = diffDateStrings(query.from, query.to);
    if (span === null || span + 1 > SERVICE_CONSUMPTION_REPORT_MAX_RANGE_DAYS) throw new BadRequestException(`Chỉ xem được tối đa ${SERVICE_CONSUMPTION_REPORT_MAX_RANGE_DAYS} ngày một lần.`);
    const scope = await this.reportBranchScope.resolve(actor, query);
    const window = vietnamDateRangeHalfOpenUtc(query.from, query.to);
    return { range: { tenantId: actor.tenantId, branchIds: scope.branchIds, start: window.startUtc, end: window.endUtc }, scope };
  }

  private header(scope: ReportBranchScope, query: { from: string; to: string }, now: Date, totals: { visitCount: number; cost: number }, serviceOptions: Array<{ key: string; name: string }>) {
    return {
      generatedAt: now.toISOString(),
      from: query.from,
      to: query.to,
      branchCount: scope.branchIds.length,
      totalCost: totals.cost,
      visitCount: totals.visitCount,
      averageCost: averageCostPerVisit(totals.cost, totals.visitCount),
      serviceOptions: serviceOptions.slice().sort((a, b) => a.name.localeCompare(b.name, 'vi')),
    };
  }

  // ---- Theo dịch vụ ----

  async getByService(actor: Actor, query: ServiceConsumptionReportQuery, now: Date = new Date()): Promise<{ report: ServiceConsumptionByServiceReport; scope: ReportBranchScope }> {
    const { range, scope } = await this.resolve(actor, query);
    const filters = { serviceKey: query.serviceKey, doctorId: query.doctorId };
    const { options, services, items, totals } = await this.unitOfWork.runInTenantScope(actor.tenantId, async (tx) => ({
      options: await this.repository.listServiceOptions(tx, range),
      services: await this.repository.sumByService(tx, range, filters),
      items: await this.repository.sumByServiceItem(tx, range, filters),
      totals: await this.repository.totals(tx, range, filters),
    }));

    const itemsByService = new Map<string, Array<{ name: string; cost: number; quantity: number }>>();
    for (const i of items) {
      const list = itemsByService.get(i.key) ?? [];
      list.push({ name: i.itemName, cost: i.cost, quantity: i.quantity });
      itemsByService.set(i.key, list);
    }
    const rows = services
      .map((s) => ({
        key: s.key,
        name: s.name,
        visitCount: s.visitCount,
        cost: s.cost,
        averageCost: averageCostPerVisit(s.cost, s.visitCount),
        topItems: topConsumedItemNames(itemsByService.get(s.key) ?? [], TOP_ITEMS_PER_SERVICE),
      }))
      .sort((a, b) => b.cost - a.cost || a.name.localeCompare(b.name, 'vi'));

    const report: ServiceConsumptionByServiceReport = {
      ...this.header(scope, query, now, totals, options),
      serviceCount: rows.length,
      rows: rows.slice(0, SERVICE_CONSUMPTION_REPORT_ROW_LIMIT),
    };
    return { report, scope };
  }

  // ---- Theo khách ----

  async getByCustomer(actor: Actor, query: ServiceConsumptionReportQuery, now: Date = new Date()): Promise<{ report: ServiceConsumptionByCustomerReport; scope: ReportBranchScope }> {
    const { range, scope } = await this.resolve(actor, query);
    const filters = { serviceKey: query.serviceKey, doctorId: query.doctorId };
    const { options, entries, totals } = await this.unitOfWork.runInTenantScope(actor.tenantId, async (tx) => ({
      options: await this.repository.listServiceOptions(tx, range),
      entries: await this.repository.listEntries(tx, range, filters, SERVICE_CONSUMPTION_REPORT_ENTRY_LIMIT),
      totals: await this.repository.totals(tx, range, filters),
    }));
    // Port tự mở kết nối → đọc SAU khi transaction đóng.
    const userIds = [...new Set(entries.flatMap((e) => [e.doctorId, e.performedBy]).filter((v): v is string => v !== null))];
    const names = userIds.length > 0 ? await this.doctorDirectory.getUserFullNames(actor.tenantId, userIds) : new Map<string, string>();

    const report: ServiceConsumptionByCustomerReport = {
      ...this.header(scope, query, now, totals, options),
      entryCount: totals.visitCount,
      entries: entries.map((e) => ({
        occurredAt: e.occurredAt.toISOString(),
        patientCode: e.patientCode,
        patientName: e.patientName,
        serviceName: e.serviceName,
        itemsText: e.itemsText,
        doctorName: e.doctorId ? (names.get(e.doctorId) ?? null) : null,
        performerName: e.performedBy ? (names.get(e.performedBy) ?? null) : null,
        cost: e.cost,
        branchName: scope.names.get(e.branchId) ?? '',
      })),
    };
    return { report, scope };
  }

  // ---- Dùng chung cho xuất Excel ----

  /** Tên phòng khám, tên chi nhánh và người xuất cho đầu báo cáo — đọc qua service/port TRƯỚC transaction chính. */
  async exportContext(actor: Actor, scope: ReportBranchScope, now: Date) {
    const [header, names] = await Promise.all([this.clinicProfileService.getPrintHeader(actor.tenantId, actor.branchId), this.doctorDirectory.getUserFullNames(actor.tenantId, [actor.userId])]);
    return buildReportExportContext(header.name, header.branchName ?? null, scope, names.get(actor.userId) ?? 'Không rõ', now);
  }

  /** Ghi nhật ký xuất Excel: ai xuất, báo cáo nào, kỳ nào, chi nhánh nào thật sự đã đọc. */
  async recordExportAudit(actor: Actor, report: string, query: { from: string; to: string }, resolvedBranchIds: string[], meta: RequestMeta, extra: Record<string, unknown> = {}): Promise<void> {
    await this.unitOfWork.runInTenantScope(actor.tenantId, (tx) =>
      writeReportExportAudit(tx, actor, { action: 'service_consumption.exported', entityType: 'service_consumption_report_export' }, report, query, resolvedBranchIds, meta, extra),
    );
  }
}
