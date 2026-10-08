import { Global, Module } from '@nestjs/common';
import { CLINICAL_ORDER_CANCELLATION_PORT } from '@nexamed/core';
import { ClinicalOrderCancellationAdapter } from '../../infrastructure/paraclinical/clinical-order-cancellation.adapter';
import { ClinicalOrderModule } from './clinical-order.module';

/**
 * Module RIÊNG chỉ để bind `CLINICAL_ORDER_CANCELLATION_PORT` (xem `packages/core/src/ports/clinical-order-cancellation.port.ts`) — cùng khuôn `StockAvailabilityModule`:
 * `ClinicalOrderModule` đã import `EncounterModule` nên `EncounterModule` chỉ `@Inject` token, không import ngược. `@Global()` để không phải khai báo ở `imports`.
 */
@Global()
@Module({
  imports: [ClinicalOrderModule],
  providers: [{ provide: CLINICAL_ORDER_CANCELLATION_PORT, useClass: ClinicalOrderCancellationAdapter }],
  exports: [CLINICAL_ORDER_CANCELLATION_PORT],
})
export class ClinicalOrderCancellationModule {}
