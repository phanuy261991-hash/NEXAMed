import { Global, Module } from '@nestjs/common';
import { APPOINTMENT_IMPACT_READER_PORT } from '@nexamed/core';
import { AppointmentImpactReaderAdapter } from '../../infrastructure/appointment/appointment-impact-reader.adapter';
import { AppointmentModule } from './appointment.module';

/**
 * Module RIÊNG chỉ để bind `APPOINTMENT_IMPACT_READER_PORT` (xem
 * `packages/core/src/ports/appointment-impact-reader.port.ts`) — `LeaveRequestModule` chỉ `@Inject`
 * token, không import `AppointmentModule`. `@Global()` để không phải khai báo ở `imports`.
 */
@Global()
@Module({
  imports: [AppointmentModule],
  providers: [{ provide: APPOINTMENT_IMPACT_READER_PORT, useClass: AppointmentImpactReaderAdapter }],
  exports: [APPOINTMENT_IMPACT_READER_PORT],
})
export class AppointmentImpactReaderModule {}
