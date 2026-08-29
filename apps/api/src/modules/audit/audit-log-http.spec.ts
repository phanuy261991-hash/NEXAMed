import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { getVietnamDateString } from '@nexamed/core';
import { AppModule } from '../../app.module';
import { ResponseInterceptor } from '../../common/response.interceptor';
import { DomainExceptionFilter } from '../../common/domain-exception.filter';
import { createTwoTenantFixture, SYSTEM_TEST_ACTOR, type TwoTenantFixture } from '../../testing/tenant-fixture';
import { seedPermissionCatalog } from '../../infrastructure/persistence/seed-permissions';
import { seedDefaultRolesForTenant } from '../../infrastructure/persistence/seed-tenant-roles';

/**
 * HTTP e2e cho "Nhật ký hoạt động" (S5-05, ADM-03) — `GET /api/v1/audit-log`. Trọng tâm: lọc theo
 * bệnh nhân phải trả về ĐẦY ĐỦ dấu vết (cả `entityType='patient'` lẫn `entityType='encounter'` của
 * các lượt khám thuộc bệnh nhân đó), không chỉ đúng 1 loại.
 */
describe('HTTP e2e — /api/v1/audit-log', () => {
  let app: INestApplication;
  let privileged: PrismaClient;
  let fixture: TwoTenantFixture;
  const password = 'Test@12345';

  let clinicAdminToken: string;
  let clinicAdminUserId: string;
  let doctorToken: string;
  let tenantBClinicAdminToken: string;

  async function createUserWithRole(tenantId: string, roleName: string) {
    const username = `e2e-audit-${roleName}-${randomUUID()}`;
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
    return { userId: user.id as string, token: login.body.data.accessToken as string };
  }

  function authed(token: string) {
    return { Authorization: `Bearer ${token}` };
  }

  function randomNationalId(): string {
    return '079' + Math.floor(100000000 + Math.random() * 899999999).toString();
  }

  async function createPatient(token: string, fullName: string) {
    const res = await request(app.getHttpServer())
      .post('/api/v1/patients')
      .set(authed(token))
      .send({ fullName, dob: '1990-01-01', gender: 'female', phone: `09${Math.floor(10000000 + Math.random() * 89999999)}`, nationalId: randomNationalId() });
    return res.body.data as { id: string; version: number };
  }

  async function createDepartment(tenantId: string, name: string) {
    const department = await privileged.department.create({
      data: { tenantId, name, isActive: true, createdBy: SYSTEM_TEST_ACTOR, updatedBy: SYSTEM_TEST_ACTOR },
    });
    return department.id as string;
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

    fixture = await createTwoTenantFixture(privileged, 'Audit log e2e');
    await seedPermissionCatalog(privileged);
    await seedDefaultRolesForTenant(privileged, fixture.tenantA.id, SYSTEM_TEST_ACTOR);
    await seedDefaultRolesForTenant(privileged, fixture.tenantB.id, SYSTEM_TEST_ACTOR);

    const clinicAdmin = await createUserWithRole(fixture.tenantA.id, 'clinic_admin');
    clinicAdminToken = clinicAdmin.token;
    clinicAdminUserId = clinicAdmin.userId;
    doctorToken = (await createUserWithRole(fixture.tenantA.id, 'doctor')).token;
    tenantBClinicAdminToken = (await createUserWithRole(fixture.tenantB.id, 'clinic_admin')).token;
  });

  afterAll(async () => {
    await fixture.cleanup();
    await privileged.$disconnect();
    await app.close();
  });

  it('không có access token → 401', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/audit-log');
    expect(res.status).toBe(401);
  });

  it('vai trò không có audit_log.read (doctor) → 403 PERMISSION_DENIED', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/audit-log').set(authed(doctorToken));
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('PERMISSION_DENIED');
  });

  it('lọc theo patientId trả về ĐẦY ĐỦ dấu vết: patient.created + patient.updated + encounter.registered_direct, không lẫn bệnh nhân khác', async () => {
    const patientA = await createPatient(clinicAdminToken, 'Nguyễn Văn Nhật Ký A');
    const patientB = await createPatient(clinicAdminToken, 'Trần Thị Khác B');

    await request(app.getHttpServer())
      .patch(`/api/v1/patients/${patientA.id}`)
      .set(authed(clinicAdminToken))
      .send({ version: patientA.version, phone: '0999888777' });

    const departmentId = await createDepartment(fixture.tenantA.id, 'Khoa Nội — audit e2e');
    const encounterRes = await request(app.getHttpServer())
      .post('/api/v1/reception/direct')
      .set(authed(clinicAdminToken))
      .send({
        patientId: patientA.id,
        departmentId,
        checkedInAt: new Date().toISOString(),
        services: [{ examTypeCode: 'KT', examTypeName: 'Khám thường', examTypePrice: 150_000, quantity: 1 }],
        receptionTypeCode: 'RT_NEW',
        examFormCode: 'EF_NORMAL',
      });
    expect(encounterRes.status).toBe(200);
    const encounterId = encounterRes.body.data.id as string;

    const res = await request(app.getHttpServer())
      .get(`/api/v1/audit-log?patientId=${patientA.id}&limit=50`)
      .set(authed(clinicAdminToken));
    expect(res.status).toBe(200);

    const items = res.body.data.items as { action: string; entityType: string; entityId: string; entityLabel: string | null }[];
    const actions = items.map((i) => i.action);
    expect(actions).toContain('patient.created');
    expect(actions).toContain('patient.updated');
    expect(actions).toContain('encounter.registered_direct');

    // Không lẫn hồ sơ patient B.
    expect(items.some((i) => i.entityId === patientB.id)).toBe(false);

    const patientCreatedEntry = items.find((i) => i.action === 'patient.created' && i.entityType === 'patient');
    expect(patientCreatedEntry?.entityId).toBe(patientA.id);
    expect(patientCreatedEntry?.entityLabel).toContain('Nguyễn Văn Nhật Ký A');

    const encounterEntry = items.find((i) => i.action === 'encounter.registered_direct' && i.entityType === 'encounter');
    expect(encounterEntry?.entityId).toBe(encounterId);
    expect(encounterEntry?.entityLabel).toContain('Nguyễn Văn Nhật Ký A');
  });

  it('lọc theo actorId trả đúng các dòng do user đó thực hiện', async () => {
    const res = await request(app.getHttpServer())
      .get(`/api/v1/audit-log?actorId=${clinicAdminUserId}&limit=50`)
      .set(authed(clinicAdminToken));
    expect(res.status).toBe(200);
    const items = res.body.data.items as { actorId: string | null; actorName: string | null }[];
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.actorId === clinicAdminUserId)).toBe(true);
    expect(items[0]?.actorName).toBeTruthy();
  });

  it('lọc theo khoảng ngày: hôm nay có dữ liệu, khoảng ngày trong quá khứ (2020) rỗng', async () => {
    const today = getVietnamDateString();
    const resToday = await request(app.getHttpServer())
      .get(`/api/v1/audit-log?actorId=${clinicAdminUserId}&from=${today}&to=${today}&limit=50`)
      .set(authed(clinicAdminToken));
    expect(resToday.status).toBe(200);
    expect(resToday.body.data.items.length).toBeGreaterThan(0);

    const resPast = await request(app.getHttpServer())
      .get(`/api/v1/audit-log?actorId=${clinicAdminUserId}&from=2020-01-01&to=2020-01-02&limit=50`)
      .set(authed(clinicAdminToken));
    expect(resPast.status).toBe(200);
    expect(resPast.body.data.items).toHaveLength(0);
  });

  it('cách ly tenant — tenant B không thấy audit_log của tenant A', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/audit-log?limit=50').set(authed(tenantBClinicAdminToken));
    expect(res.status).toBe(200);
    const items = res.body.data.items as { actorId: string | null }[];
    expect(items.every((i) => i.actorId !== clinicAdminUserId)).toBe(true);
  });
});
