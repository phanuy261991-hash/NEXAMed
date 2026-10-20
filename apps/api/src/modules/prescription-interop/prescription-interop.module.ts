import { Module } from '@nestjs/common';
import { IamModule } from '../iam/iam.module';
import { PrescriptionInteropController } from './prescription-interop.controller';
import { PrescriptionInteropRepository } from './prescription-interop.repository';
import { PrescriptionInteropService } from './prescription-interop.service';

/**
 * Liên thông đơn thuốc quốc gia (docs/DECISIONS.md #242 GĐ3) — sở hữu bảng `interop_facility_credential`/`interop_doctor_credential` + khoá cấu hình `prescription_interop`.
 * `imports: [IamModule]` cho `DOCTOR_DIRECTORY_PORT`/`BRANCH_DIRECTORY_PORT` (không import thẳng service của `iam`).
 */
@Module({
  imports: [IamModule],
  controllers: [PrescriptionInteropController],
  providers: [PrescriptionInteropService, PrescriptionInteropRepository],
  exports: [PrescriptionInteropService],
})
export class PrescriptionInteropModule {}
