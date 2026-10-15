import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { SystemModule } from '../system/system.module';
import { SingleTenantOnlyGuard } from '../../common/single-tenant-only.guard';
import { SoftwareUpdateController } from './software-update.controller';
import { SoftwareUpdateService } from './software-update.service';

/**
 * Kiểm tra cập nhật phần mềm (#236, bước 2). `UPDATE_CHECK_PORT` đăng ký Global ở `PortsModule`; `imports` chỉ để lấy `SystemVersionService` (phiên bản đang chạy) và
 * `AuditLogRepository` (đọc lịch sử kiểm tra) mà hai module kia export — không module nào import ngược lại nên không vòng.
 */
@Module({
  imports: [SystemModule, AuditModule],
  controllers: [SoftwareUpdateController],
  providers: [SoftwareUpdateService, SingleTenantOnlyGuard],
})
export class SoftwareUpdateModule {}
