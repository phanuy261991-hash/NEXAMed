import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { tenantContextStorage } from '../infrastructure/persistence/tenant-context.store';

/**
 * TẠM THỜI (S1-03): đọc tenantId/actorId từ header thay vì claim JWT thật, vì auth (S1-04)
 * chưa tồn tại. Khi S1-04 xong, thay nguồn đọc bằng payload JWT đã xác thực — không đổi cách
 * TenantContextStore hay UnitOfWorkService được dùng ở phía dưới. Không dùng header này cho
 * môi trường thật: bất kỳ client nào cũng có thể tự đặt header, không có xác thực.
 * Xem docs/DECISIONS.md #012.
 */
@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  use(req: Request, _res: Response, next: NextFunction) {
    const tenantId = req.header('x-tenant-id') ?? undefined;
    const actorId = req.header('x-actor-id') ?? undefined;
    tenantContextStorage.run({ tenantId, actorId }, () => next());
  }
}