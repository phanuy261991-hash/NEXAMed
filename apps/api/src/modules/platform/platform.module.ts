import { Module } from '@nestjs/common';
import { PlatformAuditRepository } from './platform-audit.repository';
import { PlatformAuditService } from './platform-audit.service';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformOperatorRepository } from './platform-operator.repository';
import { PlatformTenantRepository } from './platform-tenant.repository';
import { PlatformTenantService } from './platform-tenant.service';
import { PlatformAuthController, PlatformTenantController } from './platform.controllers';
import { PlatformAuthGuard, PlatformHostGuard } from './platform.guards';

/**
 * Khu quản trị nền tảng SaaS (docs/DECISIONS.md #237, Đợt 4): người vận hành đăng nhập mật khẩu + OTP, quản lý công ty khách hàng (tạo, sửa liên hệ, khoá/mở khoá, đặt lại mật khẩu quản trị), xem nhật ký vận hành.
 * CHỈ có ở chế độ SaaS và chỉ trên tên miền phụ quản trị — chế độ một công ty trả 404 cho mọi đường dẫn (`PlatformHostGuard`). `TenantHostService`, `JwtService`, `UnitOfWorkService` đến từ module global.
 * Không đọc dữ liệu bệnh nhân; không "đăng nhập thay" vào công ty.
 */
@Module({
  controllers: [PlatformAuthController, PlatformTenantController],
  providers: [
    PlatformOperatorRepository,
    PlatformAuditRepository,
    PlatformTenantRepository,
    PlatformAuthService,
    PlatformTenantService,
    PlatformAuditService,
    PlatformHostGuard,
    PlatformAuthGuard,
  ],
})
export class PlatformModule {}
