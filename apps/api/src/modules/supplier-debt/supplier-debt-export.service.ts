import { Inject, Injectable } from '@nestjs/common';
import { DOCTOR_DIRECTORY_PORT, getVietnamDateString, type DoctorDirectoryPort } from '@nexamed/core';
import type { ExportSupplierDebtQuery } from '@nexamed/shared';
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
