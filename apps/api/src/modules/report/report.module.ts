import { Module } from '@nestjs/common';
import { ClinicModule } from '../clinic/clinic.module';
import { IamModule } from '../iam/iam.module';
import { ReferenceCatalogModule } from '../reference-catalog/reference-catalog.module';
import { DailyReportController } from './daily-report.controller';
import { DailyReportRepository } from './daily-report.repository';
import { DailyReportService } from './daily-report.service';
import { DashboardController } from './dashboard.controller';
import { DashboardRepository } from './dashboard.repository';
import { DashboardService } from './dashboard.service';
import { DoctorReportController } from './doctor-report.controller';
import { DoctorReportRepository } from './doctor-report.repository';
import { DoctorReportService } from './doctor-report.service';
import { OperationsReportController } from './operations-report.controller';
import { OperationsReportRepository } from './operations-report.repository';
import { OperationsReportService } from './operations-report.service';
import { PharmacyReportController } from './pharmacy-report.controller';
import { PharmacyReportRepository } from './pharmacy-report.repository';
import { PharmacyReportService } from './pharmacy-report.service';
import { RevenueReportController } from './revenue-report.controller';
import { RevenueReportRepository } from './revenue-report.repository';
import { RevenueReportService } from './revenue-report.service';

/**
 * Hệ thống báo cáo + Trang Tổng quan (docs/DECISIONS.md #279, `docs/product/reporting-plan.md`). Mô-đun ĐỌC TỔNG HỢP, không sở hữu bảng nào và không ghi dữ liệu (ngoài nhật ký xuất Excel):
 * `DashboardRepository` đọc nhiều bảng bằng SQL phẳng, mọi công thức tiền ở `@nexamed/core`. Nhập `ReferenceCatalogModule` để đọc tên "Hình thức thanh toán" qua
 * `REFERENCE_CATALOG_READER_PORT`, `ClinicModule` để đọc công tắc "hiện tiền trên Tổng quan bác sĩ" qua `CLINIC_CONFIG_READER_PORT` và tên phòng khám ở đầu Excel qua `ClinicProfileService`,
 * `IamModule` cho `DOCTOR_DIRECTORY_PORT` (tên người xuất) — không có vòng phụ thuộc. "Báo cáo ngày" (#287) dùng lại `DashboardRepository`.
 */
@Module({
  imports: [ReferenceCatalogModule, ClinicModule, IamModule],
  controllers: [DashboardController, DailyReportController, OperationsReportController, RevenueReportController, DoctorReportController, PharmacyReportController],
  providers: [DashboardService, DashboardRepository, DailyReportService, DailyReportRepository, OperationsReportService, OperationsReportRepository, RevenueReportService, RevenueReportRepository, DoctorReportService, DoctorReportRepository, PharmacyReportService, PharmacyReportRepository],
})
export class ReportModule {}
