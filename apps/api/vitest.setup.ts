// Nạp apps/api/.env cho test (integration test chạm Postgres thật cần DATABASE_URL/
// MIGRATE_DATABASE_URL). Không lỗi nếu thiếu .env — CI set biến môi trường trực tiếp.
import 'dotenv/config';