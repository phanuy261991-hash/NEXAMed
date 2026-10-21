import 'reflect-metadata';
import cookieParser from 'cookie-parser';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { ResponseInterceptor } from './common/response.interceptor';
import { DomainExceptionFilter } from './common/domain-exception.filter';
import { SYSTEM_ACTOR_ID } from '@nexamed/core';
import { PrismaService } from './infrastructure/persistence/prisma.service';
import { UnitOfWorkService } from './infrastructure/persistence/unit-of-work.service';
import { findMissingPermissionKeys, syncRolePermissionsForAllTenants } from './infrastructure/persistence/sync-role-permissions';

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.setGlobalPrefix('api/v1', { exclude: ['health'] });
  // Bắt buộc để `OnModuleDestroy` chạy khi container nhận SIGTERM (S6-06) — `PuppeteerPdfRendererAdapter`
  // cần đóng tiến trình Chromium đang giữ, không tự tắt theo NestJS mặc định nếu thiếu dòng này.
  app.enableShutdownHooks();

  const configService = app.get(ConfigService);
  app.enableCors({ origin: configService.getOrThrow<string>('WEB_ORIGIN'), credentials: true });

  // IP thật của người dùng khi API đứng sau reverse proxy (docs/DECISIONS.md #244). Mặc định 0 =
  // không tin `X-Forwarded-For` (ai cũng tự khai được). Đặt đúng số lớp proxy thì `req.ip` mới là IP
  // máy trạm — giới hạn tần suất đăng nhập tính theo từng máy thay vì gộp cả hệ thống, và nhật ký
  // hoạt động ghi đúng IP để còn điều tra sự cố.
  const trustProxyHops = configService.getOrThrow<number>('TRUST_PROXY_HOPS');
  if (trustProxyHops > 0) app.set('trust proxy', trustProxyHops);

  app.use(cookieParser());
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new DomainExceptionFilter());

  // Cảnh báo TO, RÕ nếu quên chạy lại `db:seed` sau khi thêm permission mới vào code — trước đây
  // âm thầm bỏ qua (xem comment trong sync-role-permissions.ts), gây menu biến mất không dấu vết
  // trong log, mất nhiều vòng debug thủ công mới tìm ra (docs/DECISIONS.md #159).
  const missingPermissions = await findMissingPermissionKeys(app.get(PrismaService));
  if (missingPermissions.length > 0) {
    console.error(
      `\n[startup] !!! DANH MỤC "permission" THIẾU ${missingPermissions.length} QUYỀN: ${missingPermissions.join(', ')}.\n` +
        `    Menu/chức năng liên quan sẽ KHÔNG hiện cho tới khi chạy: pnpm --filter @nexamed/api run db:seed\n`,
    );
  }

  // Đồng bộ role_permission còn thiếu cho tenant đã tồn tại (permission mới thêm sau khi tenant
  // đã tạo) — xem docs/CURRENT.md mục "Đang chờ" (phát hiện lúc #037) và sync-role-permissions.ts.
  const added = await syncRolePermissionsForAllTenants(
    app.get(PrismaService),
    app.get(UnitOfWorkService),
    SYSTEM_ACTOR_ID,
  );
  if (added.length > 0) {
    console.log(`[startup] Đồng bộ role_permission: thêm ${added.length} dòng còn thiếu (${added.join(', ')}).`);
  }

  await app.listen(configService.getOrThrow<number>('PORT'));
}

bootstrap();
