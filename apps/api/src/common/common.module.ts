import { Global, Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { TenantContextMiddleware } from './tenant-context.middleware';
import { JwtAuthGuard } from './jwt-auth.guard';
import { AuditViewInterceptor } from './audit-view.interceptor';

/**
 * Hạ tầng dùng chung xuyên module: middleware set tenant context từ JWT, guard xác thực tối
 * thiểu cho route cần đăng nhập, interceptor ghi audit cho thao tác xem (chưa áp vào controller
 * nào — xem jwt-auth.guard.ts, audit-view.interceptor.ts). `JwtModule.register({})` không set
 * secret mặc định vì TokenService/JwtAuthGuard tự truyền `JWT_SECRET` từ ConfigService vào từng
 * lời gọi sign/verify — không cấu hình 2 nơi.
 */
@Global()
@Module({
  imports: [JwtModule.register({})],
  providers: [TenantContextMiddleware, JwtAuthGuard, AuditViewInterceptor],
  exports: [TenantContextMiddleware, JwtAuthGuard, AuditViewInterceptor, JwtModule],
})
export class CommonModule {}
