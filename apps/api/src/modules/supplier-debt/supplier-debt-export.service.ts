import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DOCTOR_DIRECTORY_PORT, formatVietnamDateDisplay, getVietnamDateString, type DoctorDirectoryPort } from '@nexamed/core';
import { SUPPLIER_DEBT_ENTRY_TYPE_LABELS, type ExportSupplierDebtQuery, type ListSupplierDebtLedgerQuery } from '@nexamed/shared';
import { buildTableReportExcel } from '../../common/report-table-excel';
import type { RequestMeta } from '../../common/request-meta';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { ClinicProfileService } from '../clinic/clinic-profile.service';
import { SupplierRepository } from '../drug/supplier.repository';
import { SupplierDebtService } from './supplier-debt.service';

interface Actor {
  tenantId: string;
  userId: string;
  branchId: string | null;
}

/**
 * Xuất Excel "Công nợ nhà cung cấp" (docs/DECISIONS.md #287). Đúng bộ lọc đang xem ở `/suppliers/debts`: tìm theo mã/tên và công tắc "Hiện cả nhà cung cấp đã tất toán / chưa phát sinh".
 * Số liệu lấy từ CHÍNH `SupplierDebtService.listSummaries()` (không tính lại công nợ ở đây), ghép mã/tên từ danh mục NCC. Công nợ là dữ liệu CHUNG cả công ty nên đầu báo cáo không ghi chi nhánh.
 * "Còn nợ" ghi SỐ CÓ DẤU: dương = còn nợ NCC, âm = NCC nợ lại phòng khám.
 */
@Injectable()
export class SupplierDebtExportService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly supplierDebtService: SupplierDebtService,
    private readonly supplierRepository: SupplierRepository,
    private readonly clinicProfileService: ClinicProfileService,
    @Inject(DOCTOR_DIRECTORY_PORT) private readonly doctorDirectory: DoctorDirectoryPort,
  ) {}

  async exportExcel(actor: Actor, query: ExportSupplierDebtQuery, now: Date = new Date()): Promise<Buffer> {
    const [header, names] = await Promise.all([this.clinicProfileService.getPrintHeader(actor.tenantId, null), this.doctorDirectory.getUserFullNames(actor.tenantId, [actor.userId])]);
    // Hai lần đọc tuần tự, mỗi lần một transaction riêng (không lồng nhau).
    const summaries = await this.supplierDebtService.listSummaries(actor.tenantId, true);
    const suppliers = await this.unitOfWork.runInTenantScope(actor.tenantId, (tx) => this.supplierRepository.list(tx, actor.tenantId, true));

    const debtBySupplier = new Map(summaries.items.map((s) => [s.supplierId, s]));
    let rows = suppliers.map((s) => ({ supplier: s, debt: debtBySupplier.get(s.id) }));
    if (!query.showAll) rows = rows.filter(({ debt }) => debt && (debt.balance !== 0 || debt.pendingApprovalAmount > 0));
    const q = query.q?.trim().toLowerCase();
    if (q) rows = rows.filter(({ supplier }) => supplier.code.toLowerCase().includes(q) || supplier.name.toLowerCase().includes(q));

    let owed = 0;
    let owedBack = 0;
    let pending = 0;
    for (const { debt } of rows) {
      if (!debt) continue;
      if (debt.balance > 0) owed += debt.balance;
      else if (debt.balance < 0) owedBack += -debt.balance;
      pending += debt.pendingApprovalAmount;
    }
    const today = getVietnamDateString(now);
    const vnd = (v: number) => v.toLocaleString('vi-VN');

    return buildTableReportExcel([
      {
        name: 'Công nợ NCC',
        header: { clinicName: header.name, title: 'Công nợ nhà cung cấp', from: today, to: today, exportedByName: names.get(actor.userId) ?? 'Không rõ', exportedAt: now },
        infoLines: [
          `Tổng còn nợ: ${vnd(owed)} · NCC đang nợ lại: ${vnd(owedBack)}${pending > 0 ? ` · Phiếu chi chờ duyệt: ${vnd(pending)}` : ''}`,
          `Bộ lọc: ${query.showAll ? 'Gồm cả nhà cung cấp đã tất toán hoặc chưa phát sinh' : 'Chỉ nhà cung cấp còn nợ, nợ lại hoặc có phiếu chi chờ duyệt'}${q ? ` · Tìm: ${query.q}` : ''}`,
          'Còn nợ: số dương = còn nợ nhà cung cấp; số âm = nhà cung cấp nợ lại.',
        ],
        sections: [
          {
            columns: [
              { header: 'Mã', width: 14 },
              { header: 'Nhà cung cấp', width: 34 },
              { header: 'Tổng tiền hàng', width: 18, numeric: true },
              { header: 'Đã thanh toán', width: 18, numeric: true },
              { header: 'Còn nợ', width: 18, numeric: true },
              { header: 'Chờ duyệt', width: 16, numeric: true },
              { header: 'Tình trạng', width: 18 },
            ],
            rows: rows.map(({ supplier, debt }) => [
              supplier.code,
              supplier.name,
              debt ? debt.totalPurchase : null,
              debt ? debt.totalPaid : null,
              debt ? debt.balance : null,
              debt ? debt.pendingApprovalAmount : null,
              !debt ? 'Chưa có sổ công nợ' : debt.balance === 0 ? 'Đã tất toán' : debt.balance < 0 ? 'NCC nợ lại' : 'Còn nợ',
            ]),
            emptyText: 'Không có nhà cung cấp nào có công nợ.',
          },
        ],
      },
    ]);
  }

  /**
   * Xuất Excel "Sổ công nợ" của MỘT nhà cung cấp/đối tác theo khoảng ngày đang xem (mỗi báo cáo đều có Excel và In, docs/DECISIONS.md #287). Số liệu lấy từ CHÍNH `listLedger()`; số tiền ghi dạng SỐ,
   * tăng nợ và giảm nợ ở hai cột riêng. Đầu bảng có số dư đầu kỳ, tăng, giảm, cuối kỳ của kỳ đang xem. Công nợ là dữ liệu CHUNG cả công ty.
   */
  async exportLedgerExcel(actor: Actor, supplierId: string, query: ListSupplierDebtLedgerQuery, now: Date = new Date()): Promise<Buffer> {
    const supplier = await this.unitOfWork.runInTenantScope(actor.tenantId, (tx) => this.supplierRepository.findById(tx, actor.tenantId, supplierId));
    if (!supplier) throw new NotFoundException();
    // Mỗi lần đọc một transaction riêng, tuần tự (không lồng nhau, #264).
    const ledger = await this.supplierDebtService.listLedger(actor.tenantId, supplierId, query);
    const [header, names] = await Promise.all([this.clinicProfileService.getPrintHeader(actor.tenantId, null), this.doctorDirectory.getUserFullNames(actor.tenantId, [actor.userId])]);

    const today = getVietnamDateString(now);
    const dateOf = (iso: string): string => {
      const [y, m, d] = getVietnamDateString(new Date(iso)).split('-');
      return `${d}/${m}/${y}`;
    };
    const dateTimeOf = (iso: string): string => {
      const parts = new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
      const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
      return `${get('day')}/${get('month')}/${get('year')} ${get('hour')}:${get('minute')}`;
    };
    const vnd = (v: number) => v.toLocaleString('vi-VN');
    const s = ledger.summary;
    const showBranch = new Set(ledger.items.map((e) => e.sourceBranchName).filter((n): n is string => !!n)).size > 1;
    const columns = [
      { header: 'Ngày chứng từ', width: 14 },
      { header: 'Ghi sổ lúc', width: 17 },
      { header: 'Loại', width: 18 },
      { header: 'Chứng từ', width: 18 },
      ...(showBranch ? [{ header: 'Chi nhánh', width: 18 }] : []),
      { header: 'Tăng nợ', width: 16, numeric: true },
      { header: 'Giảm nợ', width: 16, numeric: true },
      { header: 'Số dư sau', width: 16, numeric: true },
      { header: 'Người thực hiện', width: 22 },
      { header: 'Ghi chú', width: 32 },
    ];
    const rows = ledger.items.map((e) => [
      dateOf(e.occurredAt),
      dateTimeOf(e.createdAt),
      SUPPLIER_DEBT_ENTRY_TYPE_LABELS[e.entryType],
      e.stockReceiptNo ?? e.stockIssueNo ?? e.cashVoucherNo ?? '',
      ...(showBranch ? [e.sourceBranchName ?? ''] : []),
      e.amountChange > 0 ? e.amountChange : null,
      e.amountChange < 0 ? -e.amountChange : null,
      e.balanceAfter,
      e.createdByName,
      [e.reversed ? 'Đã bị đảo' : '', e.note ?? ''].filter(Boolean).join(' · '),
    ]);
    const period = query.from || query.to ? `Từ ${query.from ? formatVietnamDateDisplay(query.from) : 'đầu'} đến ${query.to ? formatVietnamDateDisplay(query.to) : 'nay'}` : 'Toàn bộ lịch sử';

    return buildTableReportExcel([
      {
        name: 'Sổ công nợ',
        header: { clinicName: header.name, title: 'Sổ công nợ nhà cung cấp', from: query.from ?? today, to: query.to ?? today, exportedByName: names.get(actor.userId) ?? 'Không rõ', exportedAt: now },
        infoLines: [
          `Nhà cung cấp: ${supplier.code} · ${supplier.name}`,
          `Kỳ: ${period}`,
          `Số dư đầu kỳ: ${vnd(s.openingBalance)} · Tăng nợ: ${vnd(s.totalIncrease)} · Giảm nợ: ${vnd(s.totalDecrease)} · Số dư cuối kỳ: ${vnd(s.closingBalance)}`,
          'Số dư: số dương = còn nợ nhà cung cấp; số âm = nhà cung cấp nợ lại. Kỳ tính theo ngày chứng từ.',
        ],
        sections: [{ columns, rows, emptyText: 'Không có bút toán nào trong kỳ.' }],
      },
    ]);
  }

  async recordLedgerExportAudit(actor: Actor, supplierId: string, query: ListSupplierDebtLedgerQuery, meta: RequestMeta): Promise<void> {
    await this.unitOfWork.runInTenantScope(actor.tenantId, (tx) =>
      writeAuditLog(tx, actor.tenantId, {
        actorId: actor.userId,
        action: 'supplier_debt.ledger_exported',
        entityType: 'supplier_debt_export',
        entityId: supplierId,
        afterJson: { from: query.from ?? null, to: query.to ?? null },
        ip: meta.ip,
        userAgent: meta.userAgent,
      }),
    );
  }

  async recordExportAudit(actor: Actor, query: ExportSupplierDebtQuery, meta: RequestMeta): Promise<void> {
    await this.unitOfWork.runInTenantScope(actor.tenantId, (tx) =>
      writeAuditLog(tx, actor.tenantId, {
        actorId: actor.userId,
        action: 'supplier_debt.exported',
        entityType: 'supplier_debt_export',
        entityId: actor.tenantId,
        afterJson: { showAll: query.showAll, hasSearch: !!query.q },
        ip: meta.ip,
        userAgent: meta.userAgent,
      }),
    );
  }
}
