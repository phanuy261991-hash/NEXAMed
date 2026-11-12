import { Global, Module } from '@nestjs/common';
import { SERVICE_CONSUMPTION_DECLINE_PORT } from '@nexamed/core';
import { ServiceConsumptionDeclineAdapter } from '../../infrastructure/inventory/service-consumption-decline.adapter';
import { InventoryModule } from './inventory.module';

/**
 * Module RIÊNG chỉ để bind `SERVICE_CONSUMPTION_DECLINE_PORT` (xem `packages/core/src/ports/service-consumption-decline.port.ts`) — cùng khuôn `ClinicalOrderCancellationModule`:
 * `clinical-order` chỉ `@Inject` token, không import `InventoryModule`. `@Global()` để không phải khai báo ở `imports`.
 */
@Global()
@Module({
  imports: [InventoryModule],
  providers: [{ provide: SERVICE_CONSUMPTION_DECLINE_PORT, useClass: ServiceConsumptionDeclineAdapter }],
  exports: [SERVICE_CONSUMPTION_DECLINE_PORT],
})
export class ServiceConsumptionDeclineModule {}
