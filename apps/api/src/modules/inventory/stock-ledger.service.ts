import { Inject, Injectable } from '@nestjs/common';
import { DOCTOR_DIRECTORY_PORT, type DoctorDirectoryPort } from '@nexamed/core';
import type { GetDrugLedgerQuery, GetDrugLedgerResponse } from '@nexamed/shared';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { StockLedgerRepository, type StockLedgerRow } from './stock-ledger.repository';

/**
 * "Thẻ kho" / "Lịch sử giao dịch" (panel chi tiết thuốc) — GĐ2 chỉ có 1 nguồn (phiếu nhập kho) nên
 * dùng CHUNG 1 endpoint cho cả 2 tab của mockup (xem comment `stockLedgerEntrySchema`).
 */
@Injectable()
export class StockLedgerService {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly stockLedgerRepository: StockLedgerRepository,
    @Inject(DOCTOR_DIRECTORY_PORT) private readonly doctorDirectory: DoctorDirectoryPort,
  ) {}

  async getForDrug(tenantId: string, drugId: string, query: GetDrugLedgerQuery): Promise<GetDrugLedgerResponse> {
    const ascRows = await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.stockLedgerRepository.listForDrug(tx, tenantId, drugId, query.warehouseId));

    let running = 0;
    const withBalance = ascRows.map((row) => {
      running += row.quantityChange;
      return { ...row, runningBalance: running };
    });
    const descRows = withBalance.slice().reverse();
    const totalCount = descRows.length;
    const page = query.limit ? descRows.slice(0, query.limit) : descRows;

    const ids = new Set(page.map((r) => r.createdBy));
    const names = ids.size > 0 ? await this.doctorDirectory.getUserFullNames(tenantId, [...ids]) : new Map<string, string>();

    return { items: page.map((row) => this.toDto(row, names)), totalCount };
  }

  private toDto(row: StockLedgerRow & { runningBalance: number }, names: Map<string, string>) {
    return {
      id: row.id,
      occurredAt: row.occurredAt.toISOString(),
      quantityChange: row.quantityChange,
      runningBalance: row.runningBalance,
      reason: row.reason,
      warehouseId: row.warehouseId,
      warehouseName: row.warehouseName,
      sourceReceiptId: row.sourceReceiptId,
      sourceReceiptNo: row.sourceReceiptNo,
      createdByName: names.get(row.createdBy) ?? 'Không rõ',
    };
  }
}
