import { describe, expect, it } from 'vitest';
import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { JwtAuthGuard } from './jwt-auth.guard';

const SECRET = 'test-secret-at-least-16-chars';
const USER_ID = '11111111-1111-1111-1111-111111111111';
const TENANT_ID = '22222222-2222-2222-2222-222222222222';

function fakeConfigService(): ConfigService {
  return { getOrThrow: () => SECRET } as unknown as ConfigService;
}

/** Mutate thẳng `req` (không spread ra object mới) để test đọc lại được `req.user` sau khi guard set. */
function contextWithHeader(authorization: string | undefined, req: Partial<Request> = {}): ExecutionContext {
  const fakeReq = req as Request;
  fakeReq.header = ((name: string) =>
    name.toLowerCase() === 'authorization' ? authorization : undefined) as Request['header'];
  return { switchToHttp: () => ({ getRequest: () => fakeReq }) } as unknown as ExecutionContext;
}

describe('JwtAuthGuard', () => {
  const jwtService = new JwtService({});
  const guard = new JwtAuthGuard(jwtService, fakeConfigService());

  it('không có header Authorization → 401', () => {
    expect(() => guard.canActivate(contextWithHeader(undefined))).toThrow(UnauthorizedException);
  });

  it('token sai định dạng → 401', () => {
    expect(() => guard.canActivate(contextWithHeader('Bearer not-a-jwt'))).toThrow(UnauthorizedException);
  });

  it('token ký sai secret → 401', () => {
    const token = jwtService.sign({ sub: USER_ID, tenantId: TENANT_ID, typ: 'access' }, { secret: 'secret-khac' });
    expect(() => guard.canActivate(contextWithHeader(`Bearer ${token}`))).toThrow(UnauthorizedException);
  });

  it('token hợp lệ nhưng typ=refresh (không phải access) → 401', () => {
    const token = jwtService.sign({ sub: USER_ID, tenantId: TENANT_ID, typ: 'refresh' }, { secret: SECRET });
    expect(() => guard.canActivate(contextWithHeader(`Bearer ${token}`))).toThrow(UnauthorizedException);
  });

  it('access token hợp lệ → cho qua, set req.user', () => {
    const token = jwtService.sign({ sub: USER_ID, tenantId: TENANT_ID, typ: 'access' }, { secret: SECRET });
    const req: Partial<Request> = {};
    const context = contextWithHeader(`Bearer ${token}`, req);

    expect(guard.canActivate(context)).toBe(true);
    expect(req.user).toEqual({ userId: USER_ID, tenantId: TENANT_ID });
  });
});
