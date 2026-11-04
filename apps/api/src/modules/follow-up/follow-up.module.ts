import { Module } from '@nestjs/common';
import { ClinicModule } from '../clinic/clinic.module';
import { IamModule } from '../iam/iam.module';
import { FollowUpController } from './follow-up.controller';
import { FollowUpRepository } from './follow-up.repository';
import { FollowUpService } from './follow-up.service';

/**
 * Trang "Hẹn tái khám" (docs/DECISIONS.md #285) — sở hữu bảng `follow_up_reminder` (nhật ký nhắc) và ĐỌC kế hoạch điều trị/lượt khám/bệnh nhân bằng SQL phẳng.
 * `ClinicModule` cho tên phòng khám ở đầu bản Excel; `IamModule` cho `DOCTOR_DIRECTORY_PORT` (tên người xuất).
 */
@Module({
  imports: [ClinicModule, IamModule],
  controllers: [FollowUpController],
  providers: [FollowUpService, FollowUpRepository],
})
export class FollowUpModule {}
