import { Module } from '@nestjs/common';
import { BackupStatusController } from './backup-status.controller';
import { BackupStatusService } from './backup-status.service';

/** S6-01 (ADM-04) — `BACKUP_STATUS_PORT` đã đăng ký Global ở `PortsModule`, không cần import. */
@Module({
  controllers: [BackupStatusController],
  providers: [BackupStatusService],
})
export class BackupStatusModule {}
