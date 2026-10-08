import { Global, Module } from '@nestjs/common';
import { PARACLINICAL_RESULTS_READER_PORT } from '@nexamed/core';
import { ParaclinicalResultsReaderAdapter } from '../../infrastructure/paraclinical/paraclinical-results-reader.adapter';
import { ParaclinicalResultModule } from './paraclinical-result.module';

/**
 * Module RIÊNG, chỉ để bind `PARACLINICAL_RESULTS_READER_PORT` (xem `packages/core/src/ports/paraclinical-results-reader.port.ts`) — cùng khuôn `StockAvailabilityModule`:
 * `imports: [ParaclinicalResultModule]` lấy `ParaclinicalResultRepository` (đã export) — chiều phụ thuộc MỘT PHÍA. `@Global()` để `EncounterModule` chỉ `@Inject` token,
 * không phải thêm `ParaclinicalResultModule` vào `imports` của nó.
 */
@Global()
@Module({
  imports: [ParaclinicalResultModule],
  providers: [{ provide: PARACLINICAL_RESULTS_READER_PORT, useClass: ParaclinicalResultsReaderAdapter }],
  exports: [PARACLINICAL_RESULTS_READER_PORT],
})
export class ParaclinicalResultsReaderModule {}
