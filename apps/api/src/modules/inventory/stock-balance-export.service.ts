import { Inject, Injectable } from '@nestjs/common';
import { DOCTOR_DIRECTORY_PORT, REFERENCE_CATALOG_READER_PORT, getVietnamDateString, type DoctorDirectoryPort, type ReferenceCatalogReaderPort } from '@nexamed/core';
import type { ListStockBalancesQuery, StockBalanceStatus } from '@nexamed/shared';
import { requireBranchId } from '../../common/branch-context';
import { formatReportDate } from '../../common/report-excel-header';
import { buildTableReportExcel, REPORT_EXPORT_ROW_LIMIT } from '../../common/report-table-excel';
import type { RequestMeta } from '../../common/request-meta';
import { writeAuditLog } from '../../infrastructure/persistence/audit-log.helper';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { ClinicProfileService } from '../clinic/clinic-profile.service';
import { StockBalanceService } from './stock-balance.service';

const STATUS_LABEL: Record<StockBalanceStatus, string> = { NORMAL: 'Bình thường', LOW: 'Sắp hết', HIGH: 'Vượt định mức', OUT: 'Hết hàng' };

interface Actor {
  tenantId: string;
  userId: string;
  branchId: string | null;
}

/**
 * Xuất Excel "Tồn kho và hạn dùng" (docs/DECISIONS.md #287): hai sheet — "Tồn kho" (đúng bộ lọc Kho/Tìm/Chỉ dưới định mức đang xem) và "Cảnh báo hạn dùng" (theo Kho đang chọn).
 * Số liệu lấy từ CHÍNH `StockBalanceService` (không tính lại tồn); tồn kho là dữ liệu THEO CHI NHÁNH nên chỉ chi nhánh đang làm việc (`requireBranchId`), đầu báo cáo ghi tên chi nhánh khi công ty có nhiều chi nhánh.
 */
@Injectable()
export class StockBalanceExportService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly stockBalanceService: StockBalanceService,
    private readonly clinicProfileService: ClinicProfileService,
    @Inject(DOCTOR_DIRECTORY_PORT) private readonly doctorDirectory: DoctorDirectoryPort,
    @Inject(REFERENCE_CATALOG_READER_PORT) private readonly referenceCatalogReader: ReferenceCatalogReaderPort,
  ) {}

  async exportExcel(actor: Actor, query: ListStockBalancesQuery, now: Date = new Date()): Promise<Buffer> {
    const branchId = requireBranchId(actor);
    const [header, names, units] = await Promise.all([
      this.clinicProfileService.getPrintHeader(actor.tenantId, branchId),
      this.doctorDirectory.getUserFullNames(actor.tenantId, [actor.userId]),
      this.referenceCatalogReader.listByCategory(actor.tenantId, 'UNIT'),
    ]);
    const unitName = new Map(units.map((u) => [u.code, u.name]));
    // Hai lần đọc tuần tự, mỗi lần một transaction riêng (không lồng nhau).
    const balances = await this.stockBalanceService.list(actor.tenantId, branchId, query);
    const expiries = await this.stockBalanceService.listExpiryWarnings(actor.tenantId, branchId, { warehouseId: query.warehouseId });

    const balanceRows = balances.items.slice(0, REPORT_EXPORT_ROW_LIMIT);
    const today = getVietnamDateString(now);
    const base = { clinicName: header.name, branchName: header.branchName ?? null, from: today, to: today, exportedByName: names.get(actor.userId) ?? 'Không rõ', exportedAt: now };
    const filterLine = `Bộ lọc: ${query.warehouseId ? 'Một kho' : 'Tất cả kho'}${query.belowMinOnly ? ' · Chỉ dưới định mức tồn' : ''}${query.q ? ` · Tìm: ${query.q}` : ''}`;

    return buildTableReportExcel([
      {
        name: 'Tồn kho',
        header: { ...base, title: 'Tồn kho theo mặt hàng' },
        infoLines: [filterLine],
        sections: [
          {
            columns: [
              { header: 'Mã', width: 14 },
              { header: 'Tên thuốc / vật tư', width: 34 },
              { header: 'Loại', width: 10 },
              { header: 'Kho', width: 22 },
              { header: 'Đơn vị', width: 12 },
              { header: 'Tồn hiện tại', width: 14, numeric: true },
              { header: 'Định mức tối thiểu', width: 16, numeric: true },
              { header: 'Định mức tối đa', width: 16, numeric: true },
              { header: 'Trạng thái', width: 16 },
            ],
            rows: balanceRows.map((b) => [
              b.drugCode,
              b.drugName,
              b.itemType === 'MEDICINE' ? 'Thuốc' : 'Vật tư',
              b.warehouseName,
              b.unitCode ? (unitName.get(b.unitCode) ?? b.unitCode) : '',
              b.quantityOnHand,
              b.minStockAlert,
              b.maxStockAlert,
              STATUS_LABEL[b.status],
            ]),
            emptyText: 'Chưa có tồn kho.',
          },
        ],
        note: balances.items.length > REPORT_EXPORT_ROW_LIMIT ? `Chỉ xuất ${REPORT_EXPORT_ROW_LIMIT.toLocaleString('vi-VN')} dòng đầu tiên; thu hẹp bộ lọc để lấy phần còn lại.` : undefined,
      },
      {
        name: 'Cảnh báo hạn dùng',
        header: { ...base, title: 'Cảnh báo hạn dùng' },
        infoLines: [`Sắp hết hạn: ${expiries.expiringSoonCount} lô · Đã hết hạn: ${expiries.expiredCount} lô · ${query.warehouseId ? 'Một kho' : 'Tất cả kho'}`],
        sections: [
          {
            columns: [
              { header: 'Số lô', width: 16 },
              { header: 'Thuốc / vật tư', width: 34 },
              { header: 'Kho', width: 22 },
              { header: 'Ngày SX', width: 14 },
              { header: 'Hạn dùng', width: 14 },
              { header: 'Số ngày còn lại', width: 16, numeric: true },
              { header: 'Tồn', width: 12, numeric: true },
              { header: 'Trạng thái', width: 16 },
            ],
            rows: expiries.items.slice(0, REPORT_EXPORT_ROW_LIMIT).map((e) => [e.batchNo, e.drugName, e.warehouseName, e.manufactureDate ? formatReportDate(e.manufactureDate) : '', formatReportDate(e.expiryDate), e.daysUntilExpiry, e.quantityOnHand, e.status === 'EXPIRED' ? 'Đã hết hạn' : 'Sắp hết hạn']),
            emptyText: 'Không có lô nào sắp hoặc đã hết hạn.',
          },
        ],
      },
    ]);
  }

  async recordExportAudit(actor: Actor, query: ListStockBalancesQuery, meta: RequestMeta): Promise<void> {
    await this.unitOfWork.runInTenantScope(actor.tenantId, (tx) =>
      writeAuditLog(tx, actor.tenantId, {
        actorId: actor.userId,
        action: 'stock_balance.exported',
        entityType: 'stock_balance_export',
        entityId: actor.tenantId,
        afterJson: { branchId: actor.branchId, warehouseFiltered: !!query.warehouseId, belowMinOnly: query.belowMinOnly, hasSearch: !!query.q },
        ip: meta.ip,
        userAgent: meta.userAgent,
      }),
    );
  }
}
