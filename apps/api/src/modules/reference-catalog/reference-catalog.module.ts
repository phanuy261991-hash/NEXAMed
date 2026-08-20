import { Module } from '@nestjs/common';
import { REFERENCE_CATALOG_READER_PORT } from '@nexamed/core';
import { ReferenceCatalogController } from './reference-catalog.controller';
import { ReferenceCatalogService } from './reference-catalog.service';
import { ReferenceCatalogRepository } from './reference-catalog.repository';
import { ReferenceCatalogReaderAdapter } from '../../infrastructure/reference-catalog/reference-catalog-reader.adapter';

/**
 * Danh mục dùng chung toàn hệ thống (Dân tộc, Quốc tịch...) — .claude/docs/architecture.md.
 * Export `REFERENCE_CATALOG_READER_PORT` (mở rộng ADM-01) để `IamModule` inject được mà không
 * import thẳng `ReferenceCatalogRepository` — đúng khuôn `DOCTOR_DIRECTORY_PORT` export từ
 * `IamModule` cho `AppointmentModule` (S2-09).
 */
@Module({
  controllers: [ReferenceCatalogController],
  providers: [
    ReferenceCatalogService,
    ReferenceCatalogRepository,
    { provide: REFERENCE_CATALOG_READER_PORT, useClass: ReferenceCatalogReaderAdapter },
  ],
  exports: [REFERENCE_CATALOG_READER_PORT],
})
export class ReferenceCatalogModule {}
