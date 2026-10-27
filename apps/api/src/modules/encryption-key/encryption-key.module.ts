import { Global, Module } from '@nestjs/common';
import { ENCRYPTION_KEY_GUARD_PORT } from '@nexamed/core';
import { EncryptionKeyController } from './encryption-key.controller';
import { EncryptionKeyRepository } from './encryption-key.repository';
import { EncryptionKeyService } from './encryption-key.service';

/**
 * Kiểm tra khoá mã hoá hệ thống (docs/DECISIONS.md #262). `@Global()` vì mọi module GHI trường mã hoá (bệnh nhân, thẻ BHYT, liên thông) cần `EncryptionKeyService.assertWritable` — cùng khuôn các
 * module hạ tầng dùng chung khác; chỉ phụ thuộc hạ tầng (UnitOfWork, ConfigService), không phụ thuộc module nghiệp vụ nào.
 */
@Global()
@Module({
  controllers: [EncryptionKeyController],
  providers: [EncryptionKeyRepository, EncryptionKeyService, { provide: ENCRYPTION_KEY_GUARD_PORT, useExisting: EncryptionKeyService }],
  exports: [EncryptionKeyService, ENCRYPTION_KEY_GUARD_PORT],
})
export class EncryptionKeyModule {}
