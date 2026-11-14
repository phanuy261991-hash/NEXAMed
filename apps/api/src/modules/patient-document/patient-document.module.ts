import { Module } from '@nestjs/common';
import { IdempotencyModule } from '../idempotency/idempotency.module';
import { PatientModule } from '../patient/patient.module';
import { PatientDocumentController } from './patient-document.controller';
import { PatientDocumentRepository } from './patient-document.repository';
import { PatientDocumentService } from './patient-document.service';

/**
 * Tab "Hình ảnh & Tài liệu" của hồ sơ bệnh nhân (docs/DECISIONS.md #299). `PatientModule` cho `PatientRepository` (kiểm bệnh nhân tồn tại/chưa bị gộp).
 * `PatientDocumentRepository` export để gộp hồ sơ (`PatientMergeModule`) chuyển tệp và thư mục sang hồ sơ đích, và để giai đoạn 2 ghi dòng tham chiếu từ nơi khác.
 */
@Module({
  imports: [PatientModule, IdempotencyModule],
  controllers: [PatientDocumentController],
  providers: [PatientDocumentService, PatientDocumentRepository],
  exports: [PatientDocumentService, PatientDocumentRepository],
})
export class PatientDocumentModule {}
