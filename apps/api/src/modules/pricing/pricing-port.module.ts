import { Global, Module } from '@nestjs/common';
import { PRICING_PORT } from '@nexamed/core';
import { PricingAdapter } from '../../infrastructure/pricing/pricing.adapter';
import { PricingModule } from './pricing.module';

/**
 * Cận lâm sàng GĐ2 — module RIÊNG chỉ để bind `PRICING_PORT` (lý do: xem `packages/core/src/ports/pricing.port.ts`, cùng khuôn
 * `StockAvailabilityModule`). `@Global()` để `InventoryModule` chỉ `@Inject(PRICING_PORT)` thẳng token, không thêm `PricingModule`
 * vào `imports` — giữ chiều phụ thuộc một phía (`PricingPortModule → PricingModule`).
 */
@Global()
@Module({
  imports: [PricingModule],
  providers: [{ provide: PRICING_PORT, useClass: PricingAdapter }],
  exports: [PRICING_PORT],
})
export class PricingPortModule {}
