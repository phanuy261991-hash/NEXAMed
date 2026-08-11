import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { UnitOfWorkService } from './unit-of-work.service';
import { CodeSequenceRepository } from './code-sequence.repository';

/**
 * `CodeSequenceRepository` đăng ký global (S2-01) cùng PrismaService/UnitOfWorkService — cấp mã
 * hiển thị (`patient_code`, `encounter_no`...) là hạ tầng cross-cutting mọi module domain cần
 * gọi, không thuộc riêng module nào (giống lý do `writeAuditLog` đặt ở đây thay vì trong `iam`).
 */
@Global()
@Module({
  providers: [PrismaService, UnitOfWorkService, CodeSequenceRepository],
  exports: [PrismaService, UnitOfWorkService, CodeSequenceRepository],
})
export class PersistenceModule {}