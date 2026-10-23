// Nạp apps/api/.env cho test (integration test chạm Postgres thật cần DATABASE_URL/
// MIGRATE_DATABASE_URL). Không lỗi nếu thiếu .env — CI set biến môi trường trực tiếp.
import 'dotenv/config';
// Bắt buộc nạp trước khi bất kỳ class có decorator NestJS nào được import — main.ts làm việc
// này ở dòng đầu tiên (xem src/main.ts). Các spec trước S1-07 chỉ `new Service(...)` tay, không
// qua NestJS DI container thật nên chưa từng cần; test HTTP e2e (Test.createTestingModule) thì
// cần, nếu thiếu thì Reflect.getMetadata('design:paramtypes', ...) trả rỗng và constructor
// injection âm thầm ra `undefined` thay vì lỗi rõ ràng.
import 'reflect-metadata';
import { vi } from 'vitest';

// Tắt TOÀN BỘ lập lịch nền (`@Cron`/`@Interval`/`@Timeout`) khi test (docs/DECISIONS.md #252). `AppModule` nạp `ScheduleModule.forRoot()`
// nên mỗi app dựng trong test đều chạy job thật (vd. bộ gửi đơn thuốc liên thông `* * * * *`), mà job quét MỌI công ty trong cùng
// Postgres — kể cả hàng chờ của spec khác đang chạy song song ở tiến trình khác — nên có thể "giành" dòng trước lần gọi tay của test
// (lỗi chập chờn `BUSY` ở prescription-submission-http.spec.ts, xuất hiện khi cả bộ chạy chậm). Test gọi service/job trực tiếp khi cần.
vi.mock('@nestjs/schedule', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@nestjs/schedule')>();
  class DisabledScheduleModule {}
  return { ...actual, ScheduleModule: { forRoot: () => ({ module: DisabledScheduleModule }) } };
});