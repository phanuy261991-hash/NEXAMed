import { Injectable } from '@nestjs/common';
import type { PricingPort } from '@nexamed/core';
import { UnitOfWorkService } from '../persistence/unit-of-work.service';
import { PricingService } from '../../modules/pricing/pricing.service';

/**
 * Adapter thật cho `PricingPort` (Cận lâm sàng GĐ2) — tự mở transaction riêng qua `UnitOfWorkService` (cùng mẫu
 * `StockAvailabilityAdapter`: port chỉ nhận `tenantId`). Đăng ký ở `PricingPortModule` (`@Global()`).
 */
@Injectable()
export class PricingAdapter implements PricingPort {
  constructor(
    private readonly unitOfWork: UnitOfWorkService,
    private readonly pricingService: PricingService,
  ) {}

  async getDrugBaseUnitPrices(tenantId: string, date: string, drugIds: string[]): Promise<Record<string, number | null>> {
    const map = await this.unitOfWork.runInTenantScope(tenantId, (tx) => this.pricingService.resolveDrugBaseUnitPricesWithin(tx, tenantId, date, drugIds));
    return Object.fromEntries(map);
  }
}
