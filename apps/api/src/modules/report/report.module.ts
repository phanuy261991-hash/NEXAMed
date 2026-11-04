import { Module } from '@nestjs/common';
import { ReferenceCatalogModule } from '../reference-catalog/reference-catalog.module';
import { DashboardController } from './dashboard.controller';
import { DashboardRepository } from './dashboard.repository';
import { DashboardService } from './dashboard.service';

/**
 * Hệ thống báo cáo + Trang Tổng quan (docs/DECISIONS.md #279, `docs/product/reporting-plan.md`). Mô-đun ĐỌC TỔNG HỢP, không sở hữu bảng nào và không ghi dữ liệu:
 * `DashboardRepository` đọc nhiều bảng bằng SQL phẳng, mọi công thức tiền ở `@nexamed/core`. Chỉ nhập `ReferenceCatalogModule` để đọc tên "Hình thức thanh toán" qua
 * `REFERENCE_CATALOG_READER_PORT` (không có vòng phụ thuộc).
 */
@Module({
  imports: [ReferenceCatalogModule],
  controllers: [DashboardController],
  providers: [DashboardService, DashboardRepository],
})
export class ReportModule {}
