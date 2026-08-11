import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TenantContextMiddleware } from './tenant-context.middleware';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuditViewInterceptor } from './audit-view.interceptor';
import { PermissionGuard } from './permission.guard';

/**
 * Hạ tầng dùng chung xuyên module: middleware set tenant context từ JWT, guard xác thực tối
 * thiểu cho route cần đăng nhập, guard phân quyền theo `data_scope`, interceptor ghi audit cho
 * thao tác xem. `JwtModule.register({})` không set secret mặc định vì TokenService/JwtAuthGuard
 * tự truyền `JWT_SECRET` từ ConfigService vào từng lời gọi sign/verify — không cấu hình 2 nơi.
 *
 * `PermissionGuard` (S2-01) inject `BreakGlassService` — không cần `imports: [IamModule]` ở đây
 * vì `IamModule` tự đánh dấu `@Global()` (xem comment ở đó): Nest resolve dependency của một
 * provider global theo context của module ĐANG DÙNG guard đó (ví dụ `PatientModule`), không phải
 * module định nghĩa `PermissionGuard`, nên `BreakGlassService` phải tự nó global thay vì chỉ
 * "chảy qua" import của `CommonModule`.
 */
@Global()
@Module({
  imports: [JwtModule.register({})],
  providers: [TenantContextMiddleware, JwtAuthGuard, PermissionGuard, AuditViewInterceptor],
  exports: [TenantContextMiddleware, JwtAuthGuard, PermissionGuard, AuditViewInterceptor, JwtModule],
})
export class CommonModule {}
