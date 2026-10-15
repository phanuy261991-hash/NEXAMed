import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { systemVersionSchema } from '@nexamed/shared';
import { ResponseInterceptor } from '../../common/response.interceptor';
import { DomainExceptionFilter } from '../../common/domain-exception.filter';

/**
 * HTTP e2e cho `GET /api/v1/system/version` (docs/DECISIONS.md #236): công khai, số liệu lấy từ bản dựng thật (biến môi trường + file ghi chú + migration đã áp trong DB), không lộ cấu hình.
 * Biến môi trường được đặt TRƯỚC khi dựng ứng dụng vì `ConfigModule` đọc một lần lúc khởi tạo.
 */
describe('HTTP e2e — Phiên bản phần mềm', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  const saved: Record<string, string | undefined> = {};
  const ENV = { APP_VERSION: '0.9.0', BUILD_ID: '127', RELEASE_CHANNEL: 'beta', RELEASED_AT: '2026-10-15', DEPLOYMENT_MODE: 'saas' } as const;

  beforeAll(async () => {
    for (const [key, value] of Object.entries(ENV)) {
      saved[key] = process.env[key];
      process.env[key] = value;
    }
    // Nạp AppModule SAU khi đặt biến môi trường: `ConfigModule.forRoot()` đọc và kiểm biến ngay lúc module được nạp, nạp trước thì giá trị mặc định (vd. DEPLOYMENT_MODE=single) thắng.
    const { AppModule } = await import('../../app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new DomainExceptionFilter());
    await app.init();
    privileged = new PrismaClient({ datasources: { db: { url: process.env.MIGRATE_DATABASE_URL } } });
    await privileged.$connect();
  });

  afterAll(async () => {
    for (const key of Object.keys(ENV)) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
    await privileged.$disconnect();
    await app.close();
  });

  it('công khai: không cần đăng nhập, trả đúng hợp đồng dùng chung', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/system/version');
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    const parsed = systemVersionSchema.safeParse(res.body.data);
    expect(parsed.success, JSON.stringify(res.body.data)).toBe(true);
  });

  it('phản ánh đúng biến môi trường của bản dựng', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/system/version');
    expect(res.body.data).toMatchObject({ version: '0.9.0', build: '127', channel: 'beta', releasedAt: '2026-10-15', deploymentMode: 'saas' });
  });

  it('phiên bản cơ sở dữ liệu là migration đã áp mới nhất thật sự trong DB', async () => {
    const rows = await privileged.$queryRaw<{ migration_name: string }[]>`
      SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL ORDER BY finished_at DESC, migration_name DESC LIMIT 1`;
    const res = await request(app.getHttpServer()).get('/api/v1/system/version');
    expect(res.body.data.schemaVersion).toBe(rows[0]!.migration_name);
  });

  it('đính kèm ghi chú phát hành của đúng phiên bản đang chạy', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/system/version');
    expect(res.body.data.notes).not.toBeNull();
    expect(res.body.data.notes.version).toBe('0.9.0');
    expect(res.body.data.notes.features.length).toBeGreaterThan(0);
  });

  it('không lộ cấu hình nhạy cảm', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/system/version');
    const text = JSON.stringify(res.body);
    for (const secret of [process.env.JWT_SECRET, process.env.ENCRYPTION_KEY, process.env.DATABASE_URL, process.env.MIGRATE_DATABASE_URL]) {
      if (secret) expect(text).not.toContain(secret);
    }
    expect(Object.keys(res.body.data).sort()).toEqual(['build', 'channel', 'deploymentMode', 'notes', 'releasedAt', 'schemaVersion', 'version']);
  });
});
