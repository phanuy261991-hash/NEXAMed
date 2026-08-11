import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { NOTIFICATION_PORT } from '@nexamed/core';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { SessionRepository } from './session.repository';
import { UserAccountAuthRepository } from './user-account-auth.repository';
import { BreakGlassController } from './break-glass.controller';
import { BreakGlassService } from './break-glass.service';
import { BreakGlassRepository } from './break-glass.repository';
import { NoopNotificationAdapter } from '../../infrastructure/notification/noop.adapter';

/**
 * Rate limit riêng cho /auth/login và /break-glass (10 request/phút/IP mỗi endpoint — mỗi
 * handler tự có bucket riêng dù dùng chung tên throttler 'login', xem @nestjs/throttler key theo
 * class+method+IP) — không áp ThrottlerGuard toàn cục để không vô tình giới hạn các endpoint
 * tương lai chưa bàn tới. Xem docs/DECISIONS.md #014 (break-glass coi login đã có rate limit sẵn
 * làm tiền lệ).
 *
 * `@Global()` (S2-01): `BreakGlassService` cần visible từ MỌI module domain tương lai
 * (patient/appointment/encounter/prescription) vì `PermissionGuard` (đặt ở `CommonModule`,
 * cũng global) inject nó — Nest resolve dependency của một global provider theo context của
 * module đang DÙNG guard đó (ví dụ `PatientModule`), không phải module định nghĩa guard, nên
 * `BreakGlassService` phải tự nó global thay vì chỉ "chảy qua" `CommonModule.imports`.
 */
@Global()
@Module({
  imports: [JwtModule.register({}), ThrottlerModule.forRoot([{ name: 'login', ttl: 60_000, limit: 10 }])],
  controllers: [AuthController, BreakGlassController],
  providers: [
    AuthService,
    TokenService,
    SessionRepository,
    UserAccountAuthRepository,
    BreakGlassService,
    BreakGlassRepository,
    { provide: NOTIFICATION_PORT, useClass: NoopNotificationAdapter },
  ],
  exports: [BreakGlassService],
})
export class IamModule {}
