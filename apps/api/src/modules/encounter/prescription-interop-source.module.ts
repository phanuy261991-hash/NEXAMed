import { Global, Module } from '@nestjs/common';
import { INTEROP_SUBMISSION_SOURCE_PORT } from '@nexamed/core';
import { InteropSubmissionSourceAdapter } from '../../infrastructure/prescription-interop/interop-submission-source.adapter';
import { EncounterModule } from './encounter.module';

/**
 * Bind `INTEROP_SUBMISSION_SOURCE_PORT` (dữ liệu để gửi đơn thuốc liên thông, docs/DECISIONS.md #242 GĐ3) — module RIÊNG, @Global, cùng khuôn `StockAvailabilityModule`. Chiều phụ thuộc MỘT phía:
 * `PrescriptionInteropSourceModule → EncounterModule → PrescriptionInteropModule`; module liên thông chỉ `@Inject` thẳng token, không import module lượt khám (tránh vòng).
 */
@Global()
@Module({
  imports: [EncounterModule],
  providers: [{ provide: INTEROP_SUBMISSION_SOURCE_PORT, useClass: InteropSubmissionSourceAdapter }],
  exports: [INTEROP_SUBMISSION_SOURCE_PORT],
})
export class PrescriptionInteropSourceModule {}
