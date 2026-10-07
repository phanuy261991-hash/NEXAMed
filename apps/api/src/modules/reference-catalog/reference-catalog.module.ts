import { Module } from '@nestjs/common';
import { REFERENCE_CATALOG_READER_PORT } from '@nexamed/core';
import { ReferenceCatalogController } from './reference-catalog.controller';
import { ReferenceCatalogService } from './reference-catalog.service';
import { ReferenceCatalogRepository } from './reference-catalog.repository';
import { ExamTypePriceRepository } from './exam-type-price.repository';
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
    ExamTypePriceRepository,
    { provide: REFERENCE_CATALOG_READER_PORT, useClass: ReferenceCatalogReaderAdapter },
  ],
  // `ReferenceCatalogService` export cho "Nhập Excel Thuốc & Vật tư" (#210, `DrugModule`) — tra tên → mã hàng loạt + tạo mục theo tên trong transaction của người gọi.
  // `ReferenceCatalogRepository`/`ExamTypePriceRepository` export cho module `pricing` (Cận lâm sàng GĐ2, #212) — đọc tên + đơn giá dịch vụ khám để tính bảng giá/gói.
  exports: [REFERENCE_CATALOG_READER_PORT, ReferenceCatalogService, ReferenceCatalogRepository, ExamTypePriceRepository],
})
export class ReferenceCatalogModule {}
