import { Global, Module } from '@nestjs/common';
import { LEAVE_READER_PORT } from '@nexamed/core';
import { LeaveReaderAdapter } from '../../infrastructure/leave/leave-reader.adapter';
import { LeaveRequestModule } from './leave-request.module';

/**
 * Module RIÊNG chỉ để bind `LEAVE_READER_PORT` (xem `packages/core/src/ports/leave-reader.port.ts`) —
 * cùng khuôn `ParaclinicalProgressReaderModule`: `AppointmentModule` chỉ `@Inject` token, không
 * import `LeaveRequestModule`. `@Global()` để không phải khai báo ở `imports`.
 */
@Global()
@Module({
  imports: [LeaveRequestModule],
  providers: [{ provide: LEAVE_READER_PORT, useClass: LeaveReaderAdapter }],
  exports: [LEAVE_READER_PORT],
})
export class LeaveReaderModule {}
