import { Global, Module } from '@nestjs/common';
import { PARACLINICAL_PROGRESS_READER_PORT } from '@nexamed/core';
import { ParaclinicalProgressReaderAdapter } from '../../infrastructure/paraclinical/paraclinical-progress-reader.adapter';
import { ClinicalOrderModule } from './clinical-order.module';

/**
 * Module RIÊNG chỉ để bind `PARACLINICAL_PROGRESS_READER_PORT` (xem `packages/core/src/ports/paraclinical-progress-reader.port.ts`) — cùng khuôn `ClinicalOrderCancellationModule`:
 * `ReceptionModule` chỉ `@Inject` token, không import `ClinicalOrderModule`. `@Global()` để không phải khai báo ở `imports`.
 */
@Global()
@Module({
  imports: [ClinicalOrderModule],
  providers: [{ provide: PARACLINICAL_PROGRESS_READER_PORT, useClass: ParaclinicalProgressReaderAdapter }],
  exports: [PARACLINICAL_PROGRESS_READER_PORT],
})
export class ParaclinicalProgressReaderModule {}
