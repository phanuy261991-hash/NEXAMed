import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  DOCTOR_DIRECTORY_PORT,
  REFERENCE_CATALOG_READER_PORT,
  createMarginAccumulator,
  diffDateStrings,
  isValidDateString,
  splitIntoMonthChunks,
  vietnamDateRangeHalfOpenUtc,
  type DoctorDirectoryPort,
  type ReferenceCatalogReaderPort,
} from '@nexamed/core';
import {
  PHARMACY_CONTROLLED_ENTRY_LIMIT,
  PHARMACY_MAX_RANGE_DAYS,
  PHARMACY_ROW_LIMIT,
  type ControlledReportQuery,
  type PharmacyControlledReport,
  type PharmacyDispensedReport,
  type PharmacyMarginReport,
  type PharmacyReportQuery,
} from '@nexamed/shared';
import { ReportBranchScopeService, type ReportBranchScope } from '../../common/report-branch-scope.service';
import { buildReportExportContext, writeReportExportAudit } from '../../common/report-export-support';
import type { RequestMeta } from '../../common/request-meta';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { ClinicProfileService } from '../clinic/clinic-profile.service';
import { PharmacyReportRepository, type PharmacyRange } from './pharmacy-report.repository';

interface Actor {
  tenantId: string;
  userId: string;
  branchId: string | null;
}

/**
 * Trang báo cáo "Thuốc và vật tư" (docs/DECISIONS.md #287), 3 tab mới: Đã phát, Lãi gộp, Kiểm soát đặc biệt. Quyền `pharmacy_report.read` (mặc định chỉ quản lý phòng khám vì có giá vốn). Phạm vi chi nhánh
 * từ `ReportBranchScopeService` (#235). Một request = MỘT transaction: phạm vi và tên đơn vị đọc TRƯỚC khi mở transaction (các port tự mở kết nối riêng, #264). Lãi gộp: tiền bán lấy từ `dueAmount`
 * sau chiết khấu (KHÔNG `invoice.total_amount`), giá vốn từ phiếu xuất kho — phép tính ở `@nexamed/core`.
 */
@Injectable()
export class PharmacyReportService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly repository: PharmacyReportRepository,
    private readonly reportBranchScope: ReportBranchScopeService,
    private readonly clinicProfileService: ClinicProfileService,
    @Inject(REFERENCE_CATALOG_READER_PORT) private readonly referenceCatalogReader: ReferenceCatalogReaderPort,
    @Inject(DOCTOR_DIRECTORY_PORT) private readonly doctorDirectory: DoctorDirectoryPort,
  ) {}

  /** Kiểm khoảng ngày rồi giải quyết phạm vi chi nhánh. */
  private async resolve(actor: Actor, query: { from: string; to: string } & Parameters<ReportBranchScopeService['resolve']>[1]): Promise<{ range: PharmacyRange; scope: ReportBranchScope }> {
    if (!isValidDateString(query.from) || !isValidDateString(query.to)) throw new BadRequestException('Ngày không hợp lệ.');
    if (query.from > query.to) throw new BadRequestException('Ngày bắt đầu phải trước hoặc bằng ngày kết thúc.');
    const span = diffDateStrings(query.from, query.to);
    if (span === null || span + 1 > PHARMACY_MAX_RANGE_DAYS) throw new BadRequestException(`Chỉ xem được tối đa ${PHARMACY_MAX_RANGE_DAYS} ngày một lần.`);
    const scope = await this.reportBranchScope.resolve(actor, query);
    const window = vietnamDateRangeHalfOpenUtc(query.from, query.to);
    return { range: { tenantId: actor.tenantId, branchIds: scope.branchIds, start: window.startUtc, end: window.endUtc }, scope };
  }

  private header(scope: ReportBranchScope, query: { from: string; to: string }, now: Date) {
    return { generatedAt: now.toISOString(), from: query.from, to: query.to, branchCount: scope.branchIds.length };
  }

  /** Tên đơn vị cơ sở theo mã, đọc qua port TRƯỚC transaction. */
  private async unitNames(tenantId: string): Promise<Map<string, string>> {
    return new Map((await this.referenceCatalogReader.listByCategory(tenantId, 'UNIT')).map((u) => [u.code, u.name]));
  }

  // ---- Đã phát ----

  async getDispensed(actor: Actor, query: PharmacyReportQuery, now: Date = new Date()): Promise<{ report: PharmacyDispensedReport; scope: ReportBranchScope }> {
    const { range, scope } = await this.resolve(actor, query);
    const units = await this.unitNames(actor.tenantId);
    const { raw, issueCount } = await this.unitOfWork.runInTenantScope(actor.tenantId, async (tx) => ({
      raw: await this.repository.sumDispensed(tx, range, query.itemType),
      issueCount: await this.repository.countDispensedIssues(tx, range, query.itemType),
    }));

    const all = raw
      .map((r) => ({
        drugId: r.drugId,
        code: r.code,
        name: r.name,
        itemType: r.itemType,
        unitName: r.unitCode ? (units.get(r.unitCode) ?? r.unitCode) : '',
        quantity: r.quantity,
        returnedQuantity: r.returnedQuantity,
        netQuantity: r.quantity - r.returnedQuantity,
        issueCount: r.issueCount,
        amount: r.amount,
      }))
      .sort((a, b) => b.amount - a.amount || a.name.localeCompare(b.name, 'vi'));
    const report: PharmacyDispensedReport = {
      ...this.header(scope, query, now),
      itemType: query.itemType,
      issueCount,
      itemCount: all.length,
      amount: raw.reduce((s, r) => s + r.amount, 0),
      returnedAmount: raw.reduce((s, r) => s + r.returnedAmount, 0),
      rows: all.slice(0, PHARMACY_ROW_LIMIT),
    };
    return { report, scope };
  }

  // ---- Lãi gộp ----

  async getMargin(actor: Actor, query: PharmacyReportQuery, now: Date = new Date()): Promise<{ report: PharmacyMarginReport; scope: ReportBranchScope }> {
    const { range, scope } = await this.resolve(actor, query);
    const units = await this.unitNames(actor.tenantId);
    const acc = createMarginAccumulator(query.itemType);
    await this.unitOfWork.runInTenantScope(actor.tenantId, async (tx) => {
      for (const chunk of splitIntoMonthChunks(query.from, query.to)) {
        const w = vietnamDateRangeHalfOpenUtc(chunk.from, chunk.to);
        acc.addInvoices(await this.repository.listMarginInvoices(tx, { ...range, start: w.startUtc, end: w.endUtc }));
      }
    });
    const { rows, totals } = acc.finish();
    const report: PharmacyMarginReport = {
      ...this.header(scope, query, now),
      itemType: query.itemType,
      totals,
      rows: rows.slice(0, PHARMACY_ROW_LIMIT).map((r) => ({
        drugId: r.drugId,
        code: r.code,
        name: r.name,
        itemType: r.itemType,
        unitName: r.unitCode ? (units.get(r.unitCode) ?? r.unitCode) : '',
        quantity: r.quantity,
        sell: r.sell,
        cost: r.cost,
        margin: r.margin,
        marginPercent: r.marginPercent,
      })),
    };
    return { report, scope };
  }

  // ---- Kiểm soát đặc biệt ----

  async getControlled(actor: Actor, query: ControlledReportQuery, now: Date = new Date()): Promise<{ report: PharmacyControlledReport; scope: ReportBranchScope }> {
    const { range, scope } = await this.resolve(actor, query);
    const units = await this.unitNames(actor.tenantId);
    const unitName = (code: string | null) => (code ? (units.get(code) ?? code) : '');
    const { balances, entries, entryCount } = await this.unitOfWork.runInTenantScope(actor.tenantId, async (tx) => ({
      balances: await this.repository.listControlledBalances(tx, range, query.controlType),
      entries: await this.repository.listControlledEntries(tx, range, query.controlType, PHARMACY_CONTROLLED_ENTRY_LIMIT),
      entryCount: await this.repository.countControlledEntries(tx, range, query.controlType),
    }));

    const rows = balances
      .map((b) => ({
        drugId: b.drugId,
        code: b.code,
        name: b.name,
        controlType: b.controlType,
        unitName: unitName(b.unitCode),
        openingQuantity: b.opening,
        receivedQuantity: b.received,
        dispensedQuantity: b.dispensed,
        otherOutQuantity: b.otherOut,
        closingQuantity: b.opening + b.received - b.dispensed - b.otherOut,
      }))
      // Mặt hàng chưa từng có biến động hoặc tồn thì không đưa vào sổ.
      .filter((r) => r.openingQuantity !== 0 || r.receivedQuantity !== 0 || r.dispensedQuantity !== 0 || r.otherOutQuantity !== 0 || r.closingQuantity !== 0)
      .sort((a, b) => a.controlType.localeCompare(b.controlType) || a.name.localeCompare(b.name, 'vi'));

    const report: PharmacyControlledReport = {
      ...this.header(scope, query, now),
      controlType: query.controlType,
      itemCount: rows.length,
      entryCount,
      rows,
      entries: entries.map((e) => ({
        date: e.date,
        issueNo: e.issueNo,
        drugCode: e.drugCode,
        drugName: e.drugName,
        controlType: e.controlType,
        unitName: unitName(e.unitCode),
        quantity: e.quantity,
        patientCode: e.patientCode,
        patientName: e.patientName,
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
      writeReportExportAudit(tx, actor, { action: 'pharmacy_report.exported', entityType: 'pharmacy_report_export' }, report, query, resolvedBranchIds, meta, extra),
    );
  }
}
