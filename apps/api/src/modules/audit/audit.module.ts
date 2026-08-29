import { Module } from '@nestjs/common';
import { PatientModule } from '../patient/patient.module';
import { EncounterModule } from '../encounter/encounter.module';
import { AuditLogController } from './audit-log.controller';
import { AuditLogService } from './audit-log.service';
import { AuditLogRepository } from './audit-log.repository';
import { SystemLogPurgeJob } from './system-log-purge.job';

/**
 * "Nhật ký hoạt động" (S5-05, ADM-03) — module điều phối thuần đọc (không sở hữu bảng nghiệp vụ
 * nào, `audit_log` là hạ tầng dùng chung ghi qua `writeAuditLog()` từ mọi module khác). `imports:
 * [PatientModule, EncounterModule]` chỉ để inject `PATIENT_READER_PORT`/`ENCOUNTER_READER_PORT` mà
 * 2 module đó export — không module nào import ngược lại `AuditModule` nên không circular (đúng
 * khuôn `ReceptionModule`, xem comment ở `patient-merge.module.ts`).
 */
@Module({
  imports: [PatientModule, EncounterModule],
  controllers: [AuditLogController],
  providers: [AuditLogService, AuditLogRepository, SystemLogPurgeJob],
})
export class AuditModule {}
