import { Module } from '@nestjs/common';
import { ReferenceCatalogController } from './reference-catalog.controller';
import { ReferenceCatalogService } from './reference-catalog.service';
import { ReferenceCatalogRepository } from './reference-catalog.repository';

/** Danh mục dùng chung toàn hệ thống (Dân tộc, Quốc tịch) — .claude/docs/architecture.md. */
@Module({
  controllers: [ReferenceCatalogController],
  providers: [ReferenceCatalogService, ReferenceCatalogRepository],
})
export class ReferenceCatalogModule {}
