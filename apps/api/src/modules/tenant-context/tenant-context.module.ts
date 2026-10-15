import { Global, Module } from '@nestjs/common';
import { TENANT_ACCESS_PORT } from '@nexamed/core';
import { SaasOnlyGuard } from '../../common/saas-only.guard';
import { TenantContextController } from './tenant-context.controller';
import { TenantDirectoryRepository } from './tenant-directory.repository';
import { TenantHostService } from './tenant-host.service';

/**
 * Nhận biết công ty theo tên miền phụ + danh bạ công ty (docs/DECISIONS.md #237, Đợt 4 SaaS). Global vì middleware, `AuthController` và module `platform` đều cần `TenantHostService`.
 * Ở chế độ một công ty mọi hàm của `TenantHostService` là "không áp dụng" và endpoint công khai trả 404.
 */
@Global()
@Module({
  controllers: [TenantContextController],
  providers: [TenantDirectoryRepository, TenantHostService, SaasOnlyGuard, { provide: TENANT_ACCESS_PORT, useExisting: TenantDirectoryRepository }],
  exports: [TenantDirectoryRepository, TenantHostService, TENANT_ACCESS_PORT],
})
export class TenantContextModule {}
