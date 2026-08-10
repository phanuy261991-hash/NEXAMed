import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Observable, from, mergeMap } from 'rxjs';
import { UnitOfWorkService } from '../infrastructure/persistence/unit-of-work.service';
import { tenantContextStorage } from '../infrastructure/persistence/tenant-context.store';
import { writeAuditLog } from '../infrastructure/persistence/audit-log.helper';
import { AUDIT_VIEW_METADATA_KEY, type AuditViewMetadata } from './audit-view.decorator';

/**
 * Ghi audit cho thao tác XEM (GET) sau khi handler trả về thành công — xem .claude/docs/
 * security-audit.md mục Audit log để biết vì sao đây là interceptor thay vì gọi trong transaction
 * như thao tác ghi (GET không có transaction nghiệp vụ nào để đồng bộ cùng).
 *
 * Dùng `mergeMap` (không phải `tap`) vì ghi audit là bất đồng bộ và PHẢI chặn response tới khi
 * ghi xong — `tap` không đợi Promise, ghi audit lỗi sẽ không lọt vào response. Handler throw thì
 * không lọt qua `next.handle()` để tới nhánh này — không audit cho lượt xem thất bại. Ghi audit tự
 * nó lỗi thì lỗi nổi lên thành response lỗi (qua DomainExceptionFilter), không nuốt.
 */
@Injectable()
export class AuditViewInterceptor implements NestInterceptor {
  constructor(
    private readonly reflector: Reflector,
    private readonly unitOfWork: UnitOfWorkService,
  ) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const metadata = this.reflector.get<AuditViewMetadata | undefined>(AUDIT_VIEW_METADATA_KEY, context.getHandler());
    if (!metadata) {
      return next.handle();
    }

    const req = context.switchToHttp().getRequest<Request>();
    const rawParam = req.params[metadata.paramName];
    const entityId = typeof rawParam === 'string' ? rawParam : undefined;
    const store = tenantContextStorage.getStore();

    return next.handle().pipe(
      mergeMap((data: unknown) => {
        if (!store?.tenantId || !entityId) {
          return from(Promise.resolve(data));
        }
        return from(
          this.recordView(store.tenantId, store.actorId ?? null, metadata.entityType, entityId, req).then(() => data),
        );
      }),
    );
  }

  private recordView(
    tenantId: string,
    actorId: string | null,
    entityType: string,
    entityId: string,
    req: Request,
  ): Promise<void> {
    return this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      await writeAuditLog(tx, tenantId, {
        actorId,
        action: `${entityType}.viewed`,
        entityType,
        entityId,
        ip: req.ip ?? null,
        userAgent: req.header('user-agent') ?? null,
      });
    });
  }
}
