import { Global, Module } from '@nestjs/common';
import { ENCOUNTER_BILLING_READER_PORT } from '@nexamed/core';
import { EncounterBillingReaderAdapter } from '../../infrastructure/billing/encounter-billing-reader.adapter';
import { BillingModule } from './billing.module';

/**
 * Module RIÊNG chỉ để bind `ENCOUNTER_BILLING_READER_PORT` (xem `packages/core/src/ports/encounter-billing-reader.port.ts`) — cùng khuôn `ParaclinicalProgressReaderModule`:
 * `EncounterModule` chỉ `@Inject` token, không import `BillingModule`. `@Global()` để không phải khai báo ở `imports`.
 */
@Global()
@Module({
  imports: [BillingModule],
  providers: [{ provide: ENCOUNTER_BILLING_READER_PORT, useClass: EncounterBillingReaderAdapter }],
  exports: [ENCOUNTER_BILLING_READER_PORT],
})
export class EncounterBillingReaderModule {}
