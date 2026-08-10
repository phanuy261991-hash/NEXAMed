import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { Reflector } from '@nestjs/core';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import { firstValueFrom, of, throwError, type Observable } from 'rxjs';
import { PrismaService } from '../infrastructure/persistence/prisma.service';
import { UnitOfWorkService } from '../infrastructure/persistence/unit-of-work.service';
import { tenantContextStorage } from '../infrastructure/persistence/tenant-context.store';
import { AuditView } from './audit-view.decorator';
import { AuditViewInterceptor } from './audit-view.interceptor';

// Integration test thật trên Postgres cục bộ, không mock — cùng pattern auth.spec.ts.

const SYSTEM_ACTOR = '00000000-0000-0000-0000-000000000000';

class DummyController {
  @AuditView('patient')
  viewWithMetadata() {}

  viewWithoutMetadata() {}
}

function fakeContext(handler: () => void, req: Partial<Request>): ExecutionContext {
  return {
    getHandler: () => handler,
    switchToHttp: () => ({ getRequest: () => req as Request }),
  } as unknown as ExecutionContext;
}

function fakeCallHandler(value: unknown, shouldThrow = false): CallHandler {
  return { handle: (): Observable<unknown> => (shouldThrow ? throwError(() => new Error('handler failed')) : of(value)) };
}

function fakeRequest(entityId: string): Partial<Request> {
  return {
    params: { id: entityId },
    ip: '127.0.0.1',
    header: (() => 'vitest') as unknown as Request['header'],
  };
}

describe('AuditViewInterceptor', () => {
  const privileged = new PrismaClient({ datasources: { db: { url: process.env.MIGRATE_DATABASE_URL } } });
  const appPrisma = new PrismaService();
  const unitOfWork = new UnitOfWorkService(appPrisma);
  const interceptor = new AuditViewInterceptor(new Reflector(), unitOfWork);

  let tenantId: string;
  const actorId = randomUUID();

  beforeAll(async () => {
    await privileged.$connect();
    await appPrisma.$connect();
    const tenant = await privileged.tenant.create({
      data: { name: `AuditView ${randomUUID()}`, createdBy: SYSTEM_ACTOR, updatedBy: SYSTEM_ACTOR },
    });
    tenantId = tenant.id;
  });

  afterAll(async () => {
    await privileged.auditLog.deleteMany({ where: { tenantId } });
    await privileged.tenant.deleteMany({ where: { id: tenantId } });
    await privileged.$disconnect();
    await appPrisma.$disconnect();
  });

  beforeEach(async () => {
    await privileged.auditLog.deleteMany({ where: { tenantId } });
  });

  function intercept(handler: () => void, req: Partial<Request>, callHandler: CallHandler): Observable<unknown> {
    let observable!: Observable<unknown>;
    tenantContextStorage.run({ tenantId, actorId }, () => {
      observable = interceptor.intercept(fakeContext(handler, req), callHandler);
    });
    return observable;
  }

  it('có @AuditView + handler thành công → ghi đúng 1 dòng audit_log "<entityType>.viewed"', async () => {
    const entityId = randomUUID();
    const req = fakeRequest(entityId);

    const result = await firstValueFrom(
      intercept(DummyController.prototype.viewWithMetadata, req, fakeCallHandler({ ok: true })),
    );
    expect(result).toEqual({ ok: true });

    const logs = await privileged.auditLog.findMany({ where: { tenantId, entityId } });
    expect(logs).toHaveLength(1);
    expect(logs[0]?.action).toBe('patient.viewed');
    expect(logs[0]?.actorId).toBe(actorId);
  });

  it('handler ném lỗi → không ghi audit, lỗi vẫn nổi lên', async () => {
    const entityId = randomUUID();
    const req = fakeRequest(entityId);

    await expect(
      firstValueFrom(intercept(DummyController.prototype.viewWithMetadata, req, fakeCallHandler(null, true))),
    ).rejects.toThrow('handler failed');

    const logs = await privileged.auditLog.findMany({ where: { tenantId, entityId } });
    expect(logs).toHaveLength(0);
  });

  it('không có @AuditView → passthrough, không ghi audit', async () => {
    const entityId = randomUUID();
    const req = fakeRequest(entityId);

    const result = await firstValueFrom(
      intercept(DummyController.prototype.viewWithoutMetadata, req, fakeCallHandler({ ok: true })),
    );
    expect(result).toEqual({ ok: true });

    const logs = await privileged.auditLog.findMany({ where: { tenantId, entityId } });
    expect(logs).toHaveLength(0);
  });
});
