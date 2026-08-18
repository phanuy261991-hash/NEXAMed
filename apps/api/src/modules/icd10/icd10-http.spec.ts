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
import { seedIcd10Catalog } from '../../infrastructure/persistence/seed-icd10';

const ALL_CHAPTER_CODES = [
  'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII',
  'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX', 'XXI', 'XXII',
];

/**
 * HTTP e2e cho module `icd10` (danh mục ICD-10 toàn hệ thống, read-only — S3-01, mở khoá một
 * phần, hiện có đủ Chương I-XXII). Cùng bản chất `geo`: bảng KHÔNG có `tenant_id`, nên "cách ly
 * tenant" ở đây có nghĩa NGƯỢC LẠI — xác nhận 2 tenant cùng thấy đúng một danh mục chung. Quyền
 * dùng lại `patient.read` (không thêm permission mới, xem comment trong icd10.controller.ts).
 */
describe('HTTP e2e — /api/v1/icd10', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let receptionistToken: string;
  let systemAdminToken: string;
  let tenantBReceptionistToken: string;

  async function createUserWithRole(tenantId: string, roleName: string) {
    const username = `e2e-${roleName}-${randomUUID()}`;
    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({
      data: {
        tenantId,
        username,
        passwordHash,
        fullName: `User ${roleName}`,
        createdBy: SYSTEM_TEST_ACTOR,
        updatedBy: SYSTEM_TEST_ACTOR,
      },
    });
    const role = await privileged.role.findFirstOrThrow({ where: { tenantId, name: roleName } });
    await privileged.userRole.create({
      data: { tenantId, userId: user.id, roleId: role.id, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });

    const login = await request(app.getHttpServer()).post('/api/v1/auth/login').send({ tenantId, username, password });
    return login.body.data.accessToken as string;
  }

  function authed(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

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

    fixture = await createTwoTenantFixture(privileged, 'Icd10 e2e');
    await seedPermissionCatalog(privileged);
    await seedIcd10Catalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);

    receptionistToken = await createUserWithRole(fixture.tenantA.id, 'receptionist');
    systemAdminToken = await createUserWithRole(fixture.tenantA.id, 'system_admin');
    tenantBReceptionistToken = await createUserWithRole(fixture.tenantB.id, 'receptionist');
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  it('không có access token → 401', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/icd10/chapters');
    expect(res.status).toBe(401);
  });

  it('GET /icd10/chapters có đúng 22 Chương theo ĐÚNG thứ tự số La Mã (không phải thứ tự chuỗi — IX phải sau V)', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/icd10/chapters').set(authed(receptionistToken));
    expect(res.status).toBe(200);
    expect(res.body.data.items.map((c: { chapterCode: string }) => c.chapterCode)).toEqual(ALL_CHAPTER_CODES);
    expect(res.body.data.items[0]).toMatchObject({ chapterCode: 'I', chapterName: 'Bệnh truyền nhiễm và ký sinh trùng' });
  });

  it('GET /icd10/groups?chapterCode=I trả danh sách Nhóm kèm blockCode/blockName, có nhóm A00', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/icd10/groups?chapterCode=I')
      .set(authed(receptionistToken));
    expect(res.status).toBe(200);
    const a00 = res.body.data.items.find((g: { groupCode: string }) => g.groupCode === 'A00');
    expect(a00).toMatchObject({ groupCode: 'A00', groupName: 'Bệnh tả', blockCode: 'A00-A09' });
  });

  it('GET /icd10/groups thiếu chapterCode → 400', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/icd10/groups').set(authed(receptionistToken));
    expect(res.status).toBe(400);
  });

  it('GET /icd10/codes?groupCode=A00 trả đúng 4 mã (A00, A00.0, A00.1, A00.9), sort theo code', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/icd10/codes?groupCode=A00')
      .set(authed(receptionistToken));
    expect(res.status).toBe(200);
    expect(res.body.data.items.map((i: { code: string }) => i.code)).toEqual(['A00', 'A00.0', 'A00.1', 'A00.9']);
    expect(res.body.data.items[0]).toMatchObject({ code: 'A00', isBillable: false });
    expect(res.body.data.items[1]).toMatchObject({ code: 'A00.0', isBillable: true });
  });

  it('GET /icd10/codes thiếu groupCode → 400', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/icd10/codes').set(authed(receptionistToken));
    expect(res.status).toBe(400);
  });

  it('GET /icd10?q=A00 tìm theo tiền tố mã, thấy đủ 4 mã nhóm A00 (có thể kèm mã khác tham chiếu chéo "A00-B99†" trong tên, ví dụ G53.1)', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/icd10?q=A00').set(authed(receptionistToken));
    expect(res.status).toBe(200);
    const codes = res.body.data.items.map((i: { code: string }) => i.code);
    expect(codes).toEqual(expect.arrayContaining(['A00', 'A00.0', 'A00.1', 'A00.9']));
  });

  it('GET /icd10?q=ta (không dấu) tìm theo tên đã chuẩn hoá, thấy "Bệnh tả"', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/icd10?q=ta').set(authed(receptionistToken));
    expect(res.status).toBe(200);
    expect(res.body.data.items.some((i: { code: string }) => i.code === 'A00')).toBe(true);
  });

  it('GET /icd10 thiếu q → 400', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/icd10').set(authed(receptionistToken));
    expect(res.status).toBe(400);
  });

  it('system_admin (patient.read = none) → 403 PERMISSION_DENIED', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/icd10/chapters').set(authed(systemAdminToken));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PERMISSION_DENIED');
  });

  it('không có chủ đích cách ly tenant — tenant B thấy đúng cùng danh mục toàn hệ thống', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/v1/icd10/chapters')
      .set(authed(tenantBReceptionistToken));
    expect(res.status).toBe(200);
    expect(res.body.data.items).toHaveLength(ALL_CHAPTER_CODES.length);
  });
});