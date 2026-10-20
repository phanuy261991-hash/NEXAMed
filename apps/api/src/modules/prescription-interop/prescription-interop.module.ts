import { Module } from '@nestjs/common';
import { IamModule } from '../iam/iam.module';
import { PrescriptionInteropController } from './prescription-interop.controller';
import { PrescriptionInteropRepository } from './prescription-interop.repository';
import { PrescriptionInteropService } from './prescription-interop.service';
import { PrescriptionSubmissionController } from './prescription-submission.controller';
import { PrescriptionSubmissionJob } from './prescription-submission.job';
import { PrescriptionSubmissionRepository } from './prescription-submission.repository';
import { PrescriptionSubmissionService } from './prescription-submission.service';

/**
 * Liên thông đơn thuốc quốc gia (docs/DECISIONS.md #242 GĐ3) — sở hữu các bảng `interop_facility_credential`/`interop_doctor_credential`/`interop_doctor_facility`/`prescription_submission` + khoá cấu hình
 * `prescription_interop`. `imports: [IamModule]` cho `DOCTOR_DIRECTORY_PORT`/`BRANCH_DIRECTORY_PORT` (không import thẳng service của `iam`).
 * `INTEROP_SUBMISSION_SOURCE_PORT` (dữ liệu để gửi: lượt khám, bệnh nhân, đơn thuốc...) do `PrescriptionInteropSourceModule` (@Global) cung cấp — module này KHÔNG import module lượt khám;
 * ngược lại `EncounterModule` import module này để xếp hàng gửi trong cùng transaction ký đơn (`exports` repository + service cấu hình).
 */
@Module({
  imports: [IamModule],
  controllers: [PrescriptionInteropController, PrescriptionSubmissionController],
  providers: [PrescriptionInteropService, PrescriptionInteropRepository, PrescriptionSubmissionRepository, PrescriptionSubmissionService, PrescriptionSubmissionJob],
  exports: [PrescriptionInteropService, PrescriptionSubmissionRepository],
})
export class PrescriptionInteropModule {}
