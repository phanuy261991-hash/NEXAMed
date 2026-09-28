import { Global, Module } from '@nestjs/common';
import { STOCK_AVAILABILITY_PORT } from '@nexamed/core';
import { InventoryModule } from './inventory.module';
import { StockAvailabilityAdapter } from '../../infrastructure/inventory/stock-availability.adapter';

/**
 * Kho Thuốc GĐ5 — module RIÊNG, chỉ để bind `STOCK_AVAILABILITY_PORT` (xem
 * `packages/core/src/ports/stock-availability.port.ts` để biết lý do KHÔNG dùng khuôn
 * `ClinicConfigReaderPort` thông thường ở đây). `imports: [InventoryModule]` để lấy
 * `StockBalanceRepository` (đã export) — CHIỀU PHỤ THUỘC CHỈ MỘT PHÍA (`StockAvailabilityModule →
 * InventoryModule`), `InventoryModule` không biết gì về module này. `@Global()` (cùng tiền lệ
 * `IamModule`/`PortsModule`) — `EncounterModule` chỉ `@Inject(STOCK_AVAILABILITY_PORT)` thẳng
 * token, KHÔNG thêm module này (hay `InventoryModule`) vào `imports` của nó — giữ đúng #165
 * ("EncounterModule không import InventoryModule").
 */
@Global()
@Module({
  imports: [InventoryModule],
  providers: [{ provide: STOCK_AVAILABILITY_PORT, useClass: StockAvailabilityAdapter }],
  exports: [STOCK_AVAILABILITY_PORT],
})
export class StockAvailabilityModule {}
