// Nạp apps/api/.env cho test (integration test chạm Postgres thật cần DATABASE_URL/
// MIGRATE_DATABASE_URL). Không lỗi nếu thiếu .env — CI set biến môi trường trực tiếp.
import 'dotenv/config';
// Bắt buộc nạp trước khi bất kỳ class có decorator NestJS nào được import — main.ts làm việc
// này ở dòng đầu tiên (xem src/main.ts). Các spec trước S1-07 chỉ `new Service(...)` tay, không
// qua NestJS DI container thật nên chưa từng cần; test HTTP e2e (Test.createTestingModule) thì
// cần, nếu thiếu thì Reflect.getMetadata('design:paramtypes', ...) trả rỗng và constructor
// injection âm thầm ra `undefined` thay vì lỗi rõ ràng.
import 'reflect-metadata';