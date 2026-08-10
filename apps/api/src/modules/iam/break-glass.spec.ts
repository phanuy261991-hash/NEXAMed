import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
import { InvalidCredentialsError, type NotificationPayload, type NotificationPort } from '@nexamed/core';
import { PrismaService } from '../../infrastructure/persistence/prisma.service';
import { UnitOfWorkService } from '../../infrastructure/persistence/unit-of-work.service';
import { UserAccountAuthRepository } from './user-account-auth.repository';
import { BreakGlassRepository } from './break-glass.repository';
import { BreakGlassService } from './break-glass.service';

// Integration test thật trên Postgres cục bộ, không mock — cùng pattern auth.spec.ts/rbac.spec.ts.

const SYSTEM_ACTOR = '00000000-0000-0000-0000-000000000000';
const TEST_PASSWORD = 'Test@12345';
const REQUEST_META = { ip: '127.0.0.1', userAgent: 'vitest' };
const ENTITY_TYPE = 'encounter';

class FakeNotificationPort implements NotificationPort {
  sent: NotificationPayload[] = [];
  async send(payload: NotificationPayload): Promise<void> {
    this.sent.push(payload);
  }
}

describe('BreakGlassService — request/tryConsume', () => {
  const privileged = new PrismaClient({ datasources: { db: { url: process.env.MIGRATE_DATABASE_URL } } });
  const appPrisma = new PrismaService();
  const unitOfWork = new UnitOfWorkService(appPrisma);
  const userAccountAuthRepository = new UserAccountAuthRepository();
  const breakGlassRepository = new BreakGlassRepository();
  const notificationPort = new FakeNotificationPort();
  const breakGlassService = new BreakGlassService(
    unitOfWork,
    userAccountAuthRepository,
    breakGlassRepository,
    notificationPort,
  );

  let tenantId: string;
  let userId: string;
  const username = `nurse-${randomUUID()}`;

  beforeAll(async () => {
    await privileged.$connect();
    await appPrisma.$connect();

    const tenant = await privileged.tenant.create({
      data: { name: `BreakGlass ${randomUUID()}`, createdBy: SYSTEM_ACTOR, updatedBy: SYSTEM_ACTOR },
    });
    tenantId = tenant.id;

    const passwordHash = await argon2.hash(TEST_PASSWORD, { type: argon2.argon2id });
    const user = await privileged.userAccount.create({
      data: {
        tenantId,
        username,
        passwordHash,
        fullName: 'Điều dưỡng Test',
        createdBy: SYSTEM_ACTOR,
        updatedBy: SYSTEM_ACTOR,
      },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await privileged.auditLog.deleteMany({ where: { tenantId } });
    await privileged.breakGlassSession.deleteMany({ where: { tenantId } });
    await privileged.tenantSetting.deleteMany({ where: { tenantId } });
    await privileged.userAccount.deleteMany({ where: { tenantId } });
    await privileged.tenant.deleteMany({ where: { id: tenantId } });
    await privileged.$disconnect();
    await appPrisma.$disconnect();
  });

  beforeEach(async () => {
    notificationPort.sent = [];
    await privileged.breakGlassSession.deleteMany({ where: { tenantId } });
    await privileged.tenantSetting.deleteMany({ where: { tenantId } });
  });

  it('đúng mật khẩu: tạo phiên với thời hạn mặc định 120 phút, gọi NotificationPort đúng 1 lần', async () => {
    const entityId = randomUUID();
    const before = new Date();
    const result = await breakGlassService.request(
      { tenantId, actorId: userId },
      { entityType: ENTITY_TYPE, entityId, reason: 'Cấp cứu ngoài giờ', password: TEST_PASSWORD },
      REQUEST_META,
    );

    const expectedMs = before.getTime() + 120 * 60 * 1000;
    expect(Math.abs(result.expiresAt.getTime() - expectedMs)).toBeLessThan(5000);

    const sessions = await privileged.breakGlassSession.findMany({ where: { tenantId, entityId } });
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.reason).toBe('Cấp cứu ngoài giờ');

    expect(notificationPort.sent).toHaveLength(1);
    expect(notificationPort.sent[0]?.type).toBe('break_glass.requested');
  });

  it('tenant_setting cấu hình riêng: dùng đúng số phút đã cấu hình thay vì mặc định', async () => {
    await privileged.tenantSetting.create({
      data: {
        tenantId,
        key: 'break_glass_duration_minutes',
        valueJson: 30,
        createdBy: SYSTEM_ACTOR,
        updatedBy: SYSTEM_ACTOR,
      },
    });

    const entityId = randomUUID();
    const before = new Date();
    const result = await breakGlassService.request(
      { tenantId, actorId: userId },
      { entityType: ENTITY_TYPE, entityId, reason: 'Test cấu hình', password: TEST_PASSWORD },
      REQUEST_META,
    );

    const expectedMs = before.getTime() + 30 * 60 * 1000;
    expect(Math.abs(result.expiresAt.getTime() - expectedMs)).toBeLessThan(5000);
  });

  it('sai mật khẩu: InvalidCredentialsError, không tạo phiên, không gọi NotificationPort', async () => {
    const entityId = randomUUID();
    await expect(
      breakGlassService.request(
        { tenantId, actorId: userId },
        { entityType: ENTITY_TYPE, entityId, reason: 'Thử sai', password: 'wrong' },
        REQUEST_META,
      ),
    ).rejects.toBeInstanceOf(InvalidCredentialsError);

    const sessions = await privileged.breakGlassSession.findMany({ where: { tenantId, entityId } });
    expect(sessions).toHaveLength(0);
    expect(notificationPort.sent).toHaveLength(0);
  });

  it('tryConsume: đúng entity trong hạn → granted true, ghi audit_log break_glass.access', async () => {
    const entityId = randomUUID();
    await breakGlassService.request(
      { tenantId, actorId: userId },
      { entityType: ENTITY_TYPE, entityId, reason: 'Cấp cứu', password: TEST_PASSWORD },
      REQUEST_META,
    );

    const result = await breakGlassService.tryConsume(tenantId, userId, ENTITY_TYPE, entityId, REQUEST_META);
    expect(result.granted).toBe(true);

    const accessLogs = await privileged.auditLog.findMany({
      where: { tenantId, action: 'break_glass.access', entityId },
    });
    expect(accessLogs).toHaveLength(1);
  });

  it('tryConsume: entity khác (chưa từng phá kính) → granted false, không ghi audit', async () => {
    const entityId = randomUUID();
    const result = await breakGlassService.tryConsume(tenantId, userId, ENTITY_TYPE, entityId, REQUEST_META);
    expect(result.granted).toBe(false);

    const accessLogs = await privileged.auditLog.findMany({ where: { tenantId, action: 'break_glass.access', entityId } });
    expect(accessLogs).toHaveLength(0);
  });

  it('tryConsume: phiên đã hết hạn → granted false', async () => {
    const entityId = randomUUID();
    const past = new Date(Date.now() - 60 * 1000);
    await privileged.breakGlassSession.create({
      data: {
        tenantId,
        actorId: userId,
        entityType: ENTITY_TYPE,
        entityId,
        reason: 'Đã hết hạn',
        occurredAt: new Date(past.getTime() - 120 * 60 * 1000),
        expiresAt: past,
      },
    });

    const result = await breakGlassService.tryConsume(tenantId, userId, ENTITY_TYPE, entityId, REQUEST_META);
    expect(result.granted).toBe(false);
  });
});
