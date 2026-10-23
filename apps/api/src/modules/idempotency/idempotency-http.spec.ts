import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { AppModule } from '../../app.module';
import { ResponseInterceptor } from '../../common/response.interceptor';
import { DomainExceptionFilter } from '../../common/domain-exception.filter';
import { createTwoTenantFixture, SYSTEM_TEST_ACTOR, type TwoTenantFixture } from '../../testing/tenant-fixture';
import { seedPermissionCatalog } from '../../infrastructure/persistence/seed-permissions';
import { seedDefaultRolesForTenant } from '../../infrastructure/persistence/seed-tenant-roles';
import { IdempotencyPurgeJob } from './idempotency-purge.job';

/**
 * HTTP e2e cho khoá chống ghi trùng (docs/DECISIONS.md #257). Thao tác thử: `POST /patients` tạo hồ sơ TRẺ EM không CCCD — thao tác không có khoá tự nhiên nên
 * trước #257 bấm lại hai lần ra hai hồ sơ (đo ở #256 bổ sung 1). Phản hồi chứa họ tên bệnh nhân nên cũng kiểm việc lưu phản hồi được MÃ HOÁ.
 */
describe('HTTP e2e — Idempotency-Key (chống ghi trùng khi mạng đứt giữa chừng)', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let receptionistA: { userId: string; token: string };
  let receptionistA2: { userId: string; token: string };
  let receptionistB: { userId: string; token: string };

  async function createUserWithRole(tenantId: string, roleName: string) {
    const username = `e2e-idem-${roleName}-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({ data: { tenantId, username, passwordHash, fullName: `User ${roleName}`, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    const role = await privileged.role.findFirstOrThrow({ where: { tenantId, name: roleName } });
    await privileged.userRole.create({ data: { tenantId, userId: user.id, roleId: role.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR } });
    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantId, username, password });
    return { userId: user.id as string, token: login.body.data.accessToken as string };
  }

  const authed = (token: string) => ({ Authorization: `Bearer ${token}` });
  const newPatientBody = (fullName: string, overrides: Record<string, unknown> = {}) => ({ fullName, dob: '2016-03-04', gender: 'female', phone: '0987000333', ...overrides });
  const createPatient = (token: string, body: Record<string, unknown>, key?: string) => {
    const req = request(app.getHttpServer()).post('/api/v1/patients').set(authed(token));
    if (key) req.set('Idempotency-Key', key);
    return req.send(body);
  };
  const patientsNamed = (tenantId: string, fullName: string) => privileged.patient.count({ where: { tenantId, fullName, deletedAt: null } });
  const rowOf = (tenantId: string, userId: string, key: string) => privileged.idempotencyKey.findFirst({ where: { tenantId, userId, requestKey: key } });
  const uniqueName = () => `Bé khoá ${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalInterceptors(new ResponseInterceptor());
    app.useGlobalFilters(new DomainExceptionFilter());
    await app.init();

    privileged = new PrismaClient({ datasources: { db: { url: process.env.MIGRATE_DATABASE_URL } } });
    await privileged.$connect();

    fixture = await createTwoTenantFixture(privileged, 'Idempotency e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);
    receptionistA = await createUserWithRole(fixture.tenantA.id, 'receptionist');
    receptionistA2 = await createUserWithRole(fixture.tenantA.id, 'receptionist');
    receptionistB = await createUserWithRole(fixture.tenantB.id, 'receptionist');
  });

  afterAll(async () => {
    await privileged.idempotencyKey.deleteMany({ where: { tenantId: { in: [fixture.tenantA.id, fixture.tenantB.id] } } });
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  it('KHÔNG có header → chạy y như cũ: hai lần gửi ra hai hồ sơ, không tạo dòng khoá nào', async () => {
    const name = uniqueName();
    const before = await privileged.idempotencyKey.count({ where: { tenantId: fixture.tenantA.id } });
    expect((await createPatient(receptionistA.token, newPatientBody(name))).status).toBe(200);
    expect((await createPatient(receptionistA.token, newPatientBody(name))).status).toBe(200);
    expect(await patientsNamed(fixture.tenantA.id, name)).toBe(2);
    expect(await privileged.idempotencyKey.count({ where: { tenantId: fixture.tenantA.id } })).toBe(before);
  });

  it('CÙNG khoá, gửi lại liên tiếp → chỉ 1 hồ sơ; lần 2 trả đúng phản hồi lần 1 và có header Idempotent-Replayed', async () => {
    const name = uniqueName();
    const key = randomUUID();
    const first = await createPatient(receptionistA.token, newPatientBody(name), key);
    const second = await createPatient(receptionistA.token, newPatientBody(name), key);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.headers['idempotent-replayed']).toBeUndefined();
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(second.body).toEqual(first.body);
    expect(second.body.data.fullName).toBe(name);
    expect(await patientsNamed(fixture.tenantA.id, name)).toBe(1);

    const row = await rowOf(fixture.tenantA.id, receptionistA.userId, key);
    expect(row).toMatchObject({ status: 'COMPLETED', method: 'POST', path: '/api/v1/patients' });
    // Phản hồi lưu ở dạng MÃ HOÁ (có họ tên bệnh nhân) — không đọc được thành chữ thường trong CSDL.
    expect(row!.responseBodyEnc).not.toBeNull();
    expect(Buffer.from(row!.responseBodyEnc!).toString('utf8')).not.toContain(name);
    expect(Buffer.from(row!.responseBodyEnc!).toString('latin1')).not.toContain('fullName');
  });

  it('CÙNG khoá, gửi ĐỒNG THỜI hai lần → chỉ 1 hồ sơ, cả hai cùng nhận một kết quả (yêu cầu thứ hai chờ rồi nhận lại kết quả lần đầu)', async () => {
    const name = uniqueName();
    const key = randomUUID();
    const [a, b] = await Promise.all([createPatient(receptionistA.token, newPatientBody(name), key), createPatient(receptionistA.token, newPatientBody(name), key)]);
    expect([a.status, b.status], JSON.stringify([a.body, b.body])).toEqual([200, 200]);
    expect(a.body.data.id).toBe(b.body.data.id);
    expect(await patientsNamed(fixture.tenantA.id, name)).toBe(1);
  });

  it('CÙNG khoá nhưng NỘI DUNG khác → 422 IDEMPOTENCY_KEY_REUSED, không ghi gì thêm', async () => {
    const name = uniqueName();
    const key = randomUUID();
    expect((await createPatient(receptionistA.token, newPatientBody(name), key)).status).toBe(200);
    const res = await createPatient(receptionistA.token, newPatientBody(name, { phone: '0987000444' }), key);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await patientsNamed(fixture.tenantA.id, name)).toBe(1);
  });

  it('thao tác LỖI nghiệp vụ nhả khoá: lần 1 thiếu dữ liệu (400), sửa rồi gửi lại cùng khoá → thành công, đúng 1 hồ sơ', async () => {
    const name = uniqueName();
    const key = randomUUID();
    const bad = await createPatient(receptionistA.token, { fullName: name }, key);
    expect(bad.status).toBe(400);
    expect((await rowOf(fixture.tenantA.id, receptionistA.userId, key))?.status).toBe('FAILED');

    const good = await createPatient(receptionistA.token, newPatientBody(name), key);
    expect(good.status).toBe(200);
    expect((await rowOf(fixture.tenantA.id, receptionistA.userId, key))?.status).toBe('COMPLETED');
    expect(await patientsNamed(fixture.tenantA.id, name)).toBe(1);
  });

  it('khoá KHÔNG phải UUID → 400 IDEMPOTENCY_KEY_INVALID, không chạy nghiệp vụ', async () => {
    const name = uniqueName();
    const res = await createPatient(receptionistA.token, newPatientBody(name), 'khong-phai-uuid');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('IDEMPOTENCY_KEY_INVALID');
    expect(await patientsNamed(fixture.tenantA.id, name)).toBe(0);
  });

  it('khoá thuộc về NGƯỜI GỬI: người dùng khác trong cùng công ty dùng cùng giá trị khoá → hai thao tác độc lập (hai hồ sơ)', async () => {
    const name = uniqueName();
    const key = randomUUID();
    expect((await createPatient(receptionistA.token, newPatientBody(name), key)).status).toBe(200);
    expect((await createPatient(receptionistA2.token, newPatientBody(name), key)).status).toBe(200);
    expect(await patientsNamed(fixture.tenantA.id, name)).toBe(2);
  });

  it('cách ly tenant: công ty khác dùng cùng giá trị khoá → độc lập, không nhận lại phản hồi của công ty này; mỗi dòng khoá gắn đúng công ty', async () => {
    const name = uniqueName();
    const key = randomUUID();
    const a = await createPatient(receptionistA.token, newPatientBody(name), key);
    const b = await createPatient(receptionistB.token, newPatientBody(name), key);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect(b.headers['idempotent-replayed']).toBeUndefined();
    expect(b.body.data.id).not.toBe(a.body.data.id);
    expect(await patientsNamed(fixture.tenantA.id, name)).toBe(1);
    expect(await patientsNamed(fixture.tenantB.id, name)).toBe(1);
    expect(await rowOf(fixture.tenantA.id, receptionistA.userId, key)).not.toBeNull();
    expect(await rowOf(fixture.tenantB.id, receptionistB.userId, key)).not.toBeNull();
    expect(await rowOf(fixture.tenantB.id, receptionistA.userId, key)).toBeNull();
  });

  it('chỉ áp cho POST: GET kèm header không tạo dòng khoá', async () => {
    const key = randomUUID();
    const res = await request(app.getHttpServer()).get('/api/v1/patients').set(authed(receptionistA.token)).set('Idempotency-Key', key);
    expect(res.status).toBe(200);
    expect(await rowOf(fixture.tenantA.id, receptionistA.userId, key)).toBeNull();
  });

  it('chưa đăng nhập: header bị bỏ qua, vẫn 401 (không tạo dòng khoá)', async () => {
    const res = await request(app.getHttpServer()).post('/api/v1/patients').set('Idempotency-Key', randomUUID()).send(newPatientBody(uniqueName()));
    expect(res.status).toBe(401);
  });

  it('khoá TREO quá lâu (IN_PROGRESS cũ hơn 2 phút) được tiếp quản; khoá còn mới với nội dung khác → 422', async () => {
    const name = uniqueName();
    const staleKey = randomUUID();
    await privileged.idempotencyKey.create({
      data: {
        tenantId: fixture.tenantA.id,
        userId: receptionistA.userId,
        requestKey: staleKey,
        requestHash: 'x',
        method: 'POST',
        path: '/api/v1/patients',
        status: 'IN_PROGRESS',
        lockedAt: new Date(Date.now() - 5 * 60_000),
        expiresAt: new Date(Date.now() + 60 * 60_000),
        createdBy: receptionistA.userId,
        updatedBy: receptionistA.userId,
      },
    });
    const taken = await createPatient(receptionistA.token, newPatientBody(name), staleKey);
    expect(taken.status).toBe(200);
    expect((await rowOf(fixture.tenantA.id, receptionistA.userId, staleKey))?.status).toBe('COMPLETED');

    const freshKey = randomUUID();
    await privileged.idempotencyKey.create({
      data: {
        tenantId: fixture.tenantA.id,
        userId: receptionistA.userId,
        requestKey: freshKey,
        requestHash: 'y',
        method: 'POST',
        path: '/api/v1/patients',
        status: 'IN_PROGRESS',
        expiresAt: new Date(Date.now() + 60 * 60_000),
        createdBy: receptionistA.userId,
        updatedBy: receptionistA.userId,
      },
    });
    const clash = await createPatient(receptionistA.token, newPatientBody(uniqueName()), freshKey);
    expect(clash.status).toBe(422);
    expect(clash.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('khoá đã HẾT HẠN được dùng lại như khoá mới (không replay bản cũ)', async () => {
    const name = uniqueName();
    const key = randomUUID();
    expect((await createPatient(receptionistA.token, newPatientBody(name), key)).status).toBe(200);
    await privileged.idempotencyKey.updateMany({ where: { tenantId: fixture.tenantA.id, userId: receptionistA.userId, requestKey: key }, data: { expiresAt: new Date(Date.now() - 60_000) } });
    const again = await createPatient(receptionistA.token, newPatientBody(name), key);
    expect(again.status).toBe(200);
    expect(again.headers['idempotent-replayed']).toBeUndefined();
    expect(await patientsNamed(fixture.tenantA.id, name)).toBe(2);
  });

  it('đã thực hiện nhưng KHÔNG còn nội dung phản hồi để trả lại (quá lớn) → 409 IDEMPOTENCY_REPLAY_UNAVAILABLE, KHÔNG ghi lại lần nữa', async () => {
    const name = uniqueName();
    const key = randomUUID();
    expect((await createPatient(receptionistA.token, newPatientBody(name), key)).status).toBe(200);
    await privileged.idempotencyKey.updateMany({ where: { tenantId: fixture.tenantA.id, userId: receptionistA.userId, requestKey: key }, data: { responseBodyEnc: null } });
    const again = await createPatient(receptionistA.token, newPatientBody(name), key);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('IDEMPOTENCY_REPLAY_UNAVAILABLE');
    expect(await patientsNamed(fixture.tenantA.id, name)).toBe(1);
  });

  it('job dọn xoá khoá đã hết hạn của công ty, giữ khoá còn hạn', async () => {
    const mk = (requestKey: string, expiresAt: Date) =>
      privileged.idempotencyKey.create({
        data: { tenantId: fixture.tenantA.id, userId: receptionistA.userId, requestKey, requestHash: 'z', method: 'POST', path: '/x', status: 'COMPLETED', expiresAt, createdBy: receptionistA.userId, updatedBy: receptionistA.userId },
      });
    const expiredKey = randomUUID();
    const liveKey = randomUUID();
    await mk(expiredKey, new Date(Date.now() - 60_000));
    await mk(liveKey, new Date(Date.now() + 60 * 60_000));

    const deleted = await app.get(IdempotencyPurgeJob).purge();
    expect(deleted).toBeGreaterThanOrEqual(1);
    expect(await rowOf(fixture.tenantA.id, receptionistA.userId, expiredKey)).toBeNull();
    expect(await rowOf(fixture.tenantA.id, receptionistA.userId, liveKey)).not.toBeNull();
  });
});
