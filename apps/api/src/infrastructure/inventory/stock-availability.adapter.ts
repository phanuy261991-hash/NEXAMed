import { Injectable } from '@nestjs/common';
import type { StockAvailabilityPort } from '@nexamed/core';
import { UnitOfWorkService } from '../persistence/unit-of-work.service';
import { StockBalanceRepository } from '../../modules/inventory/stock-balance.repository';

/**
 * Adapter thật cho `StockAvailabilityPort` (Kho Thuốc GĐ5) — đọc `stock_balance` qua
 * `StockBalanceRepository` (module `inventory`), tự mở transaction riêng qua `UnitOfWorkService`
 * (cùng mẫu `DoctorDirectoryAdapter` — port chỉ nhận `tenantId`, không có `tx` sẵn từ caller).
 * Đăng ký ở `StockAvailabilityModule` (`@Global()`, tự `imports: [InventoryModule]`) — KHÔNG đăng
 * ký chung `PortsModule` (module đó cố ý không phụ thuộc module nghiệp vụ nào).
 */
@Injectable()
export class StockAvailabilityAdapter implements StockAvailabilityPort {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly stockBalanceRepository: StockBalanceRepository,
  ) {}

  getOnHandQuantities(tenantId: string, drugIds: string[]): Promise<Record<string, number>> {
    return this.unitOfWork.runInTenantScope(tenantId, (tx) => this.stockBalanceRepository.sumOnHandByDrugIds(tx, tenantId, drugIds));
  }
}
