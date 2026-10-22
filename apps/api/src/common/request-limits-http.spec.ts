import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { AppModule } from '../app.module';
import { ResponseInterceptor } from './response.interceptor';
import { DomainExceptionFilter } from './domain-exception.filter';

/**
 * Lỗi 4xx do chính Express/body-parser ném (thân yêu cầu quá lớn, JSON hỏng) phải trả đúng mã 4xx + khung lỗi chuẩn của hệ thống, không rơi xuống 500 và không ghi log lỗi oan.
 * Phát hiện khi kiểm thực tế nâng NestJS 11 / Express 5 (docs/DECISIONS.md #249): thân JSON 2 MB trả 500 `INTERNAL_ERROR`.
 */
describe('HTTP e2e — giới hạn thân yêu cầu và JSON hỏng', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new DomainExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('thân JSON 2 MB → 413 PAYLOAD_TOO_LARGE bằng tiếng Việt, không phải 500', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ filler: 'a'.repeat(2 * 1024 * 1024) }));
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    expect(res.body.error.message).toBe('Dữ liệu gửi lên quá lớn.');
  });

  it('JSON hỏng → 400 trong khung lỗi chuẩn, không phải 500', async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/auth/login').set('Content-Type', 'application/json').send('{"tenantId": ');
    expect(res.status).toBe(400);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).not.toBe('INTERNAL_ERROR');
  });

  it('lỗi thật của máy chủ (không phải 4xx của thư viện) vẫn là 500 INTERNAL_ERROR, không lộ chi tiết', async () => {
    const filter = new DomainExceptionFilter();
    let status = 0;
    let body: unknown = null;
    const response = {
      status(s: number) {
        status = s;
        return this;
      },
      json(b: unknown) {
        body = b;
      },
    };
    const host = { switchToHttp: () => ({ getResponse: () => response, getRequest: () => ({}) }) };
    filter.catch(new Error('chi tiết nội bộ không được lộ'), host as never);
    expect(status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('chi tiết nội bộ');
  });
});
