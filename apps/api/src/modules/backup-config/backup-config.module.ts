import { Module } from '@nestjs/common';
import { BackupConfigController } from './backup-config.controller';
import { BackupConfigService } from './backup-config.service';

/** Cấu hình sao lưu dữ liệu (#217) — `BACKUP_CONTROL_PORT` đã đăng ký Global ở `PortsModule`. */
@Module({
  controllers: [BackupConfigController],
  providers: [BackupConfigService],
})
export class BackupConfigModule {}
