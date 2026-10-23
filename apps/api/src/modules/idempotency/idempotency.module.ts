import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { IdempotencyInterceptor } from './idempotency.interceptor';
import { IdempotencyKeyRepository } from './idempotency-key.repository';
import { IdempotencyPurgeJob } from './idempotency-purge.job';
import { IdempotencyService } from './idempotency.service';

/**
 * Chống ghi trùng khi mạng đứt giữa chừng (docs/DECISIONS.md #257). `APP_INTERCEPTOR` đăng ký TOÀN CỤC ngay trong module (cần DI), nên cả `main.ts` lẫn mọi
 * test dựng app từ `AppModule` đều có — endpoint nào cũng được phủ, không cần gắn decorator. Không module nghiệp vụ nào import module này.
 */
@Module({
  providers: [IdempotencyKeyRepository, IdempotencyService, IdempotencyPurgeJob, { provide: APP_INTERCEPTOR, useClass: IdempotencyInterceptor }],
})
export class IdempotencyModule {}
