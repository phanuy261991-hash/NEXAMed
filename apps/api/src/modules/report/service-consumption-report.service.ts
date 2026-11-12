import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  DOCTOR_DIRECTORY_PORT,
  REFERENCE_CATALOG_READER_PORT,
  averageCostPerVisit,
  diffDateStrings,
  indexConsumptionRevenue,
  isValidDateString,
  serviceMarginPercent,
  sharePercent,
  topConsumedItemNames,
  visitRevenue,
  vietnamDateRangeHalfOpenUtc,
  type DoctorDirectoryPort,
  type ReferenceCatalogReaderPort,
} from '@nexamed/core';
import {
  SERVICE_CONSUMPTION_REPORT_ENTRY_LIMIT,
  SERVICE_CONSUMPTION_REPORT_MAX_RANGE_DAYS,
  SERVICE_CONSUMPTION_REPORT_ROW_LIMIT,
  type ServiceConsumptionByBranchReport,
  type ServiceConsumptionByCustomerReport,
  type ServiceConsumptionByItemReport,
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
    @Inject(REFERENCE_CATALOG_READER_PORT) private readonly referenceCatalogReader: ReferenceCatalogReaderPort,
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

  private header(scope: ReportBranchScope, query: { from: string; to: string }, now: Date, totals: { visitCount: number; cost: number; revenue: number }, serviceOptions: Array<{ key: string; name: string }>) {
    const margin = totals.revenue - totals.cost;
    return {
      generatedAt: now.toISOString(),
      from: query.from,
      to: query.to,
      branchCount: scope.branchIds.length,
      totalCost: totals.cost,
      visitCount: totals.visitCount,
      averageCost: averageCostPerVisit(totals.cost, totals.visitCount),
      totalRevenue: totals.revenue,
      totalMargin: margin,
      marginPercent: serviceMarginPercent(totals.revenue, margin),
      serviceOptions: serviceOptions.slice().sort((a, b) => a.name.localeCompare(b.name, 'vi')),
    };
  }

  /**
   * Doanh thu ghi nhận của từng lượt dịch vụ (#297 bổ sung 4): nạp phiếu thu có dòng nguồn trùng các lượt, chia `dueAmount` xuống dòng rồi xuống dịch vụ trong gói. Chỉ SQL, chạy trong
   * CÙNG transaction với truy vấn lượt (không gọi port). Phiếu huỷ/hoàn toàn phần không có doanh thu; `refunded` đánh dấu để web ghi "Đã hoàn tiền".
   */
  private async loadRevenue(tx: Prisma.TransactionClient, tenantId: string, visits: ReadonlyArray<{ orderItemId: string | null; serviceItemId: string | null; packageId: string | null }>) {
    const unique = (values: Array<string | null>): string[] => [...new Set(values.filter((v): v is string => v !== null))];
    const refs = { orderItemIds: unique(visits.map((v) => v.orderItemId)), serviceItemIds: unique(visits.map((v) => v.serviceItemId)), packageIds: unique(visits.map((v) => v.packageId)) };
    const invoices = await this.repository.listRevenueInvoices(tx, tenantId, refs);
    const packageItems = await this.repository.listPackageItems(tx, tenantId, refs.packageIds);
    const index = indexConsumptionRevenue(invoices.active, packageItems);
    return {
      revenueOf: (v: { orderItemId: string | null; serviceItemId: string | null }): number => visitRevenue(index, v),
      refundedOf: (v: { orderItemId: string | null; serviceItemId: string | null; packageId: string | null }): boolean =>
        visitRevenue(index, v) === 0 &&
        ((v.orderItemId !== null && invoices.inactiveOrderItemIds.has(v.orderItemId)) ||
          (v.serviceItemId !== null && invoices.inactiveServiceItemIds.has(v.serviceItemId)) ||
          (v.packageId !== null && invoices.inactivePackageIds.has(v.packageId))),
    };
  }

  private visitTotals(visits: ReadonlyArray<{ cost: number; revenue: number }>) {
    return { visitCount: visits.length, cost: visits.reduce((s, v) => s + v.cost, 0), revenue: visits.reduce((s, v) => s + v.revenue, 0) };
  }

  /** Mọi lượt khớp bộ lọc kèm doanh thu — nền của ba tab Theo dịch vụ, Theo khách, Theo chi nhánh. */
  private async loadVisits(tx: Prisma.TransactionClient, range: ServiceConsumptionRange, filters: { serviceKey?: string; doctorId?: string }) {
    const raw = await this.repository.listVisits(tx, range, filters);
    const revenue = await this.loadRevenue(tx, range.tenantId, raw);
    const visits = raw.map((v) => ({ ...v, revenue: revenue.revenueOf(v) }));
    return { visits, revenue };
  }

  /**
   * Lãi gộp dịch vụ của một khoảng (doanh thu ghi nhận trừ chi phí tiêu hao, các lượt đã ghi) — dùng cho cột "Lãi gộp dịch vụ" của Toàn hệ thống (#297 bổ sung 4). Chạy trong transaction của người gọi,
   * chỉ SQL (không gọi port).
   */
  async sumServiceMargin(tx: Prisma.TransactionClient, range: ServiceConsumptionRange): Promise<number> {
    const { visits } = await this.loadVisits(tx, range, {});
    return visits.reduce((s, v) => s + v.revenue - v.cost, 0);
  }

  /** Lãi gộp dịch vụ theo từng dịch vụ của một khoảng — cho bảng xếp hạng "Lãi gộp dịch vụ" của Toàn hệ thống. Cùng điều kiện với {@link sumServiceMargin}. */
  async sumServiceMarginByService(tx: Prisma.TransactionClient, range: ServiceConsumptionRange): Promise<Array<{ key: string; name: string; visitCount: number; margin: number }>> {
    const { visits } = await this.loadVisits(tx, range, {});
    const byService = new Map<string, { key: string; name: string; visitCount: number; margin: number }>();
    for (const v of visits) {
      const row = byService.get(v.key) ?? { key: v.key, name: v.name, visitCount: 0, margin: 0 };
      row.visitCount += 1;
      row.margin += v.revenue - v.cost;
      byService.set(v.key, row);
    }
    return [...byService.values()];
  }

  // ---- Theo dịch vụ ----

  async getByService(actor: Actor, query: ServiceConsumptionReportQuery, now: Date = new Date()): Promise<{ report: ServiceConsumptionByServiceReport; scope: ReportBranchScope }> {
    const { range, scope } = await this.resolve(actor, query);
    const filters = { serviceKey: query.serviceKey, doctorId: query.doctorId };
    const { options, loaded, items } = await this.unitOfWork.runInTenantScope(actor.tenantId, async (tx) => ({
      options: await this.repository.listServiceOptions(tx, range),
      loaded: await this.loadVisits(tx, range, filters),
      items: await this.repository.sumByServiceItem(tx, range, filters),
    }));

    const itemsByService = new Map<string, Array<{ name: string; cost: number; quantity: number }>>();
    for (const i of items) {
      const list = itemsByService.get(i.key) ?? [];
      list.push({ name: i.itemName, cost: i.cost, quantity: i.quantity });
      itemsByService.set(i.key, list);
    }
    const byService = new Map<string, { key: string; name: string; visitCount: number; cost: number; revenue: number }>();
    for (const v of loaded.visits) {
      const row = byService.get(v.key) ?? { key: v.key, name: v.name, visitCount: 0, cost: 0, revenue: 0 };
      row.visitCount += 1;
      row.cost += v.cost;
      row.revenue += v.revenue;
      byService.set(v.key, row);
    }
    const rows = [...byService.values()]
      .map((s) => ({
        key: s.key,
        name: s.name,
        visitCount: s.visitCount,
        cost: s.cost,
        averageCost: averageCostPerVisit(s.cost, s.visitCount),
        revenue: s.revenue,
        margin: s.revenue - s.cost,
        marginPercent: serviceMarginPercent(s.revenue, s.revenue - s.cost),
        topItems: topConsumedItemNames(itemsByService.get(s.key) ?? [], TOP_ITEMS_PER_SERVICE),
      }))
      .sort((a, b) => b.cost - a.cost || a.name.localeCompare(b.name, 'vi'));

    const report: ServiceConsumptionByServiceReport = {
      ...this.header(scope, query, now, this.visitTotals(loaded.visits), options),
      serviceCount: rows.length,
      rows: rows.slice(0, SERVICE_CONSUMPTION_REPORT_ROW_LIMIT),
    };
    return { report, scope };
  }

  // ---- Theo khách ----

  async getByCustomer(actor: Actor, query: ServiceConsumptionReportQuery, now: Date = new Date()): Promise<{ report: ServiceConsumptionByCustomerReport; scope: ReportBranchScope }> {
    const { range, scope } = await this.resolve(actor, query);
    const filters = { serviceKey: query.serviceKey, doctorId: query.doctorId };
    const { options, entries, loaded } = await this.unitOfWork.runInTenantScope(actor.tenantId, async (tx) => ({
      options: await this.repository.listServiceOptions(tx, range),
      entries: await this.repository.listEntries(tx, range, filters, SERVICE_CONSUMPTION_REPORT_ENTRY_LIMIT),
      loaded: await this.loadVisits(tx, range, filters),
    }));
    // Port tự mở kết nối → đọc SAU khi transaction đóng.
    const userIds = [...new Set(entries.flatMap((e) => [e.doctorId, e.performedBy]).filter((v): v is string => v !== null))];
    const names = userIds.length > 0 ? await this.doctorDirectory.getUserFullNames(actor.tenantId, userIds) : new Map<string, string>();

    const totals = this.visitTotals(loaded.visits);
    const report: ServiceConsumptionByCustomerReport = {
      ...this.header(scope, query, now, totals, options),
      entryCount: totals.visitCount,
      entries: entries.map((e) => {
        const revenue = loaded.revenue.revenueOf(e);
        return {
          occurredAt: e.occurredAt.toISOString(),
          patientCode: e.patientCode,
          patientName: e.patientName,
          serviceName: e.serviceName,
          itemsText: e.itemsText,
          doctorName: e.doctorId ? (names.get(e.doctorId) ?? null) : null,
          performerName: e.performedBy ? (names.get(e.performedBy) ?? null) : null,
          cost: e.cost,
          revenue,
          margin: revenue - e.cost,
          refunded: loaded.revenue.refundedOf(e),
          branchName: scope.names.get(e.branchId) ?? '',
        };
      }),
    };
    return { report, scope };
  }

  // ---- Theo vật tư ----

  async getByItem(actor: Actor, query: ServiceConsumptionReportQuery, now: Date = new Date()): Promise<{ report: ServiceConsumptionByItemReport; scope: ReportBranchScope }> {
    const { range, scope } = await this.resolve(actor, query);
    const filters = { serviceKey: query.serviceKey, doctorId: query.doctorId };
    const { options, items, itemServices } = await this.unitOfWork.runInTenantScope(actor.tenantId, async (tx) => ({
      options: await this.repository.listServiceOptions(tx, range),
      items: await this.repository.sumByItem(tx, range, filters),
      itemServices: await this.repository.sumByItemService(tx, range, filters),
    }));

    // Port tự mở kết nối → đọc tên đơn vị SAU khi transaction đóng.
    const units = new Map((await this.referenceCatalogReader.listByCategory(actor.tenantId, 'UNIT')).map((u) => [u.code, u.name]));
    const servicesByItem = new Map<string, Array<{ name: string; cost: number }>>();
    for (const s of itemServices) {
      const list = servicesByItem.get(s.drugId) ?? [];
      list.push({ name: s.serviceName, cost: s.cost });
      servicesByItem.set(s.drugId, list);
    }
    const totalCost = items.reduce((s, i) => s + i.cost, 0);
    const rows = items
      .map((i) => {
        const services = (servicesByItem.get(i.drugId) ?? []).slice().sort((a, b) => b.cost - a.cost || a.name.localeCompare(b.name, 'vi'));
        return {
          key: i.drugId,
          name: i.name,
          itemType: i.itemType,
          serviceNames: services.slice(0, 2).map((s) => s.name),
          serviceCount: services.length,
          quantity: i.quantity,
          unitName: i.unitCode ? (units.get(i.unitCode) ?? i.unitCode) : '',
          // Giá vốn trung bình mỗi đơn vị = chi phí chia số lượng, làm tròn nửa lên về 1 đồng.
          averageUnitCost: averageCostPerVisit(i.cost, i.quantity),
          cost: i.cost,
          sharePercent: sharePercent(i.cost, totalCost),
        };
      })
      .sort((a, b) => b.cost - a.cost || a.name.localeCompare(b.name, 'vi'));

    const report: ServiceConsumptionByItemReport = {
      generatedAt: now.toISOString(),
      from: query.from,
      to: query.to,
      branchCount: scope.branchIds.length,
      totalCost,
      itemCount: rows.length,
      medicineCount: rows.filter((r) => r.itemType === 'MEDICINE').length,
      supplyCount: rows.filter((r) => r.itemType === 'SUPPLY').length,
      topItem: rows[0] ? { name: rows[0].name, sharePercent: rows[0].sharePercent } : null,
      serviceOptions: options.slice().sort((a, b) => a.name.localeCompare(b.name, 'vi')),
      rows: rows.slice(0, SERVICE_CONSUMPTION_REPORT_ROW_LIMIT),
    };
    return { report, scope };
  }

  // ---- Theo chi nhánh ----

  async getByBranch(actor: Actor, query: ServiceConsumptionReportQuery, now: Date = new Date()): Promise<{ report: ServiceConsumptionByBranchReport; scope: ReportBranchScope }> {
    const { range, scope } = await this.resolve(actor, query);
    const filters = { serviceKey: query.serviceKey, doctorId: query.doctorId };
    const { options, loaded } = await this.unitOfWork.runInTenantScope(actor.tenantId, async (tx) => ({
      options: await this.repository.listServiceOptions(tx, range),
      loaded: await this.loadVisits(tx, range, filters),
    }));

    const byBranch = new Map<string, { visitCount: number; cost: number; revenue: number }>();
    for (const v of loaded.visits) {
      const row = byBranch.get(v.branchId) ?? { visitCount: 0, cost: 0, revenue: 0 };
      row.visitCount += 1;
      row.cost += v.cost;
      row.revenue += v.revenue;
      byBranch.set(v.branchId, row);
    }
    // Chi nhánh trong phạm vi nhưng chưa có lượt nào vẫn hiện một dòng 0 để so sánh đủ.
    const rows = scope.branchIds
      .map((branchId) => {
        const row = byBranch.get(branchId) ?? { visitCount: 0, cost: 0, revenue: 0 };
        return {
          branchId,
          branchName: scope.names.get(branchId) ?? '',
          visitCount: row.visitCount,
          revenue: row.revenue,
          cost: row.cost,
          averageCost: averageCostPerVisit(row.cost, row.visitCount),
          margin: row.revenue - row.cost,
          marginPercent: serviceMarginPercent(row.revenue, row.revenue - row.cost),
        };
      })
      .sort((a, b) => b.cost - a.cost || a.branchName.localeCompare(b.branchName, 'vi'));

    const report: ServiceConsumptionByBranchReport = { ...this.header(scope, query, now, this.visitTotals(loaded.visits), options), rows };
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
