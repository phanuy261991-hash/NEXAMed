import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ThrottlerModule } from '@nestjs/throttler';
import { DOCTOR_DIRECTORY_PORT, NOTIFICATION_PORT } from '@nexamed/core';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { SessionRepository } from './session.repository';
import { UserAccountAuthRepository } from './user-account-auth.repository';
import { BreakGlassController } from './break-glass.controller';
import { BreakGlassService } from './break-glass.service';
import { BreakGlassRepository } from './break-glass.repository';
import { UserAccountController } from './user-account.controller';
import { UserAccountService } from './user-account.service';
import { UserAccountRepository } from './user-account.repository';
import { RoleController } from './role.controller';
import { RoleService } from './role.service';
import { RoleRepository } from './role.repository';
import { RolePermissionRepository } from './role-permission.repository';
import { DepartmentController } from './department.controller';
import { DepartmentService } from './department.service';
import { DepartmentRepository } from './department.repository';
import { DepartmentTypeController } from './department-type.controller';
import { DepartmentTypeService } from './department-type.service';
import { DepartmentTypeRepository } from './department-type.repository';
import { NoopNotificationAdapter } from '../../infrastructure/notification/noop.adapter';
import { DoctorDirectoryAdapter } from '../../infrastructure/directory/doctor-directory.adapter';
import { ReferenceCatalogModule } from '../reference-catalog/reference-catalog.module';

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
 * `BreakGlassService` phải tự nó global thay vì chỉ "chảy qua" `CommonModule.imports`. Cùng lý do
 * đó áp dụng cho `DOCTOR_DIRECTORY_PORT` (S2-09) — `AppointmentModule` cần inject port này mà
 * không tự `imports: [IamModule]`. Lưu ý: `@Global()` KHÔNG tự động "chảy" mọi provider ra ngoài
 * — chỉ những gì có trong `exports` mới global thật sự (bug thật gặp lúc chạy test đầu tiên:
 * quên thêm `DOCTOR_DIRECTORY_PORT` vào `exports`, Nest báo không resolve được dependency dù
 * module đã global).
 */
@Global()
@Module({
  imports: [
    JwtModule.register({}),
    ThrottlerModule.forRoot([{ name: 'login', ttl: 60_000, limit: 10 }]),
    // Cần REFERENCE_CATALOG_READER_PORT cho UserAccountService (mở rộng ADM-01, tự động vô hiệu
    // hoá tài khoản theo Trạng thái làm việc) — không có chiều ngược lại (ReferenceCatalogModule
    // không import IamModule), không circular.
    ReferenceCatalogModule,
  ],
  controllers: [
    AuthController,
    BreakGlassController,
    UserAccountController,
    RoleController,
    DepartmentController,
    DepartmentTypeController,
  ],
  providers: [
    AuthService,
    TokenService,
    SessionRepository,
    UserAccountAuthRepository,
    BreakGlassService,
    BreakGlassRepository,
    UserAccountService,
    UserAccountRepository,
    RoleService,
    RoleRepository,
    RolePermissionRepository,
    DepartmentService,
    DepartmentRepository,
    DepartmentTypeService,
    DepartmentTypeRepository,
    { provide: NOTIFICATION_PORT, useClass: NoopNotificationAdapter },
    { provide: DOCTOR_DIRECTORY_PORT, useClass: DoctorDirectoryAdapter },
  ],
  exports: [BreakGlassService, DOCTOR_DIRECTORY_PORT],
})
export class IamModule {}
