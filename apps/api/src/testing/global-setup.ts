import { spawnSync } from 'node:child_process';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

/**
 * Vitest globalSetup (S1-07) — chạy đúng một lần trong tiến trình chính của Vitest, TRƯỚC khi
 * Vitest tách worker chạy từng file test. Dựng một Postgres 18 tạm bằng testcontainers, áp
 * migration thật lên đó, rồi set `DATABASE_URL`/`MIGRATE_DATABASE_URL` trỏ vào container này —
 * mọi spec đọc hai biến này qua `process.env` (trực tiếp hoặc qua Prisma datasource mặc định
 * trong schema.prisma) nên không cần sửa lại bất kỳ file test nào đã có (`tenant-isolation.spec.ts`,
 * `rbac.spec.ts`, `auth.spec.ts`, `break-glass.spec.ts`, `audit-view.interceptor.spec.ts`).
 *
 * Thay thế phụ thuộc vào Postgres bên ngoài (docker-compose cục bộ) cho riêng bước `pnpm test`:
 * mỗi lần chạy có một DB sạch, cô lập hoàn toàn, không cần nhớ `docker compose up -d` trước.
 * Không đụng tới docker-compose.yml/CI service Postgres — hai bước `db:check-schema`/`db:deploy`/
 * `db:seed` trong CI vẫn xác minh migration/seed script chạy được trên một Postgres "thật" độc
 * lập với testcontainers, giữ nguyên giá trị kiểm chứng riêng của chúng.
 */
let container: StartedPostgreSqlContainer | undefined;

export async function setup(): Promise<void> {
  container = await new PostgreSqlContainer('postgres:18')
    .withDatabase('nexamed')
    .withUsername('nexamed')
    .withPassword('nexamed')
    .start();

  const migrateUrl = `${container.getConnectionUri()}?schema=public`;
  // nexamed_app do chính migration tạo, mật khẩu hard-code 'nexamed_app' — chỉ dùng cho
  // local dev/CI/test (xem prisma/migrations/20260807170922_tenant_context, docs/DECISIONS.md #010).
  // Tuỳ chọn dò lỗi cạn bể kết nối (docs/DECISIONS.md #264, #296): `TEST_DB_CONNECTION_LIMIT=1 pnpm test` ép mỗi bể Prisma chỉ
  // còn N kết nối — chỗ nào giữ một kết nối rồi xin thêm kết nối khác (giao dịch lồng nhau) sẽ tự khoá và lộ ra ngay thay vì
  // chỉ chập chờn lúc máy bận. Không đặt biến này thì giữ mặc định của Prisma (2 × số CPU + 1).
  const poolLimit = process.env.TEST_DB_CONNECTION_LIMIT;
  const poolParams = poolLimit && /^[1-9]\d{0,2}$/.test(poolLimit) ? `&connection_limit=${poolLimit}&pool_timeout=30` : '';
  const appUrl = migrateUrl.replace('nexamed:nexamed@', 'nexamed_app:nexamed_app@') + poolParams;

  process.env.MIGRATE_DATABASE_URL = migrateUrl;
  process.env.DATABASE_URL = appUrl;

  const result = spawnSync('prisma', ['migrate', 'deploy'], {
    stdio: 'inherit',
    shell: true,
    env: { ...process.env, DATABASE_URL: migrateUrl },
  });

  if (result.status !== 0) {
    throw new Error('src/testing/global-setup: prisma migrate deploy lên Postgres testcontainers thất bại.');
  }
}

export async function teardown(): Promise<void> {
  await container?.stop();
}
