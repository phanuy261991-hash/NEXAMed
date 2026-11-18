import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';

/**
 * Role ứng dụng luôn dùng kế hoạch theo giá trị tham số thật (docs/DECISIONS.md #304): đo 18/11/2026 cho thấy sau 5 lần chạy câu lệnh có tham số, Postgres chuyển sang "kế hoạch chung"
 * và chọn vòng lặp lồng quét lại cả bảng hoá đơn cho mỗi lượt khám (báo cáo doanh thu ~550 ms ở 1.400 hoá đơn, tăng theo bình phương). Migration `20261118090000_app_role_custom_plans`
 * đặt `plan_cache_mode = force_custom_plan` cho `nexamed_app`; test này chặn việc bỏ/ghi đè cấu hình đó.
 */
describe('plan_cache_mode của role ứng dụng', () => {
  let app: PrismaClient;
  let migrate: PrismaClient;

  beforeAll(async () => {
    app = new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL } } });
    migrate = new PrismaClient({ datasources: { db: { url: process.env.MIGRATE_DATABASE_URL } } });
    await Promise.all([app.$connect(), migrate.$connect()]);
  });
  afterAll(async () => {
    await Promise.all([app.$disconnect(), migrate.$disconnect()]);
  });

  it('role nexamed_app được cấu hình force_custom_plan', async () => {
    const rows = await migrate.$queryRaw<{ rolconfig: string[] | null }[]>`SELECT rolconfig FROM pg_roles WHERE rolname = 'nexamed_app'`;
    expect(rows[0]?.rolconfig ?? []).toContain('plan_cache_mode=force_custom_plan');
  });

  it('kết nối thật của ứng dụng nhận cấu hình đó', async () => {
    const rows = await app.$queryRaw<{ plan_cache_mode: string }[]>`SHOW plan_cache_mode`;
    expect(rows[0]?.plan_cache_mode).toBe('force_custom_plan');
  });
});
