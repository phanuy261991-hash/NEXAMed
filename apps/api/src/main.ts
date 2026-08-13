import 'reflect-metadata';
import cookieParser from 'cookie-parser';
import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module';
import { ResponseInterceptor } from './common/response.interceptor';
import { DomainExceptionFilter } from './common/domain-exception.filter';
import { PrismaService } from './infrastructure/persistence/prisma.service';
import { UnitOfWorkService } from './infrastructure/persistence/unit-of-work.service';
import { syncRolePermissionsForAllTenants } from './infrastructure/persistence/sync-role-permissions';

const SYSTEM_ACTOR = '00000000-0000-0000-0000-000000000000';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');

  const configService = app.get(ConfigService);
  app.enableCors({ origin: configService.getOrThrow<string>('WEB_ORIGIN'), credentials: true });

  app.use(cookieParser());
  app.useGlobalInterceptors(new ResponseInterceptor());
  app.useGlobalFilters(new DomainExceptionFilter());

  // Đồng bộ role_permission còn thiếu cho tenant đã tồn tại (permission mới thêm sau khi tenant
  // đã tạo) — xem docs/CURRENT.md mục "Đang chờ" (phát hiện lúc #037) và sync-role-permissions.ts.
  const added = await syncRolePermissionsForAllTenants(
    app.get(PrismaService),
    app.get(UnitOfWorkService),
    SYSTEM_ACTOR,
  );
  if (added.length > 0) {
    console.log(`[startup] Đồng bộ role_permission: thêm ${added.length} dòng còn thiếu (${added.join(', ')}).`);
  }

  await app.listen(configService.getOrThrow<number>('PORT'));
}

bootstrap();