import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { maxDataScope } from '@nexamed/core';
import { UnitOfWorkService } from '../infrastructure/persistence/unit-of-work.service';
import { findScopesForUserPermission } from '../infrastructure/persistence/permission-lookup.helper';
import { BreakGlassService } from '../modules/iam/break-glass.service';
import { PERMISSION_METADATA_KEY, type PermissionMetadata } from './require-permission.decorator';

/**
 * Guard `data_scope` thật đầu tiên của dự án (S2-01, module `patient` là controller nghiệp vụ
 * đầu tiên — việc đã treo từ Sprint 1, xem docs/TASK.md "Đang chờ"). Đọc `role_permission` theo
 * .claude/docs/security-audit.md: gộp scope từ mọi vai trò user đang giữ (lấy scope rộng nhất),
 * `none`/không có dòng nào → chặn — thử break-glass nếu route có `entityIdParam` (chỉ áp dụng
 * cho route thao tác một bản ghi cụ thể, không áp dụng cho list/create); không có phiên
 * break-glass hợp lệ → 403 kèm `breakGlassAvailable: true` (đúng yêu cầu ở security-audit.md).
 *
 * Route không gắn `@RequirePermission()` thì cho qua (guard này chỉ kiểm khi có yêu cầu rõ ràng —
 * mọi controller nghiệp vụ từ S2 trở đi PHẢI gắn decorator, không dựa vào guard tự suy luận).
 *
 * Giới hạn đã biết ở S2-01: `patient` không có khái niệm "chủ sở hữu"/"khoa phụ trách" trong
 * .claude/docs/security-audit.md (bảng data_scope liệt kê ví dụ cho `encounter`/`vital_sign`/
 * `clinical_note`, không có `patient`) — nên `personal`/`department` được coi tương đương
 * `global` cho `patient.*` (không lọc theo owner). Ma trận mặc định (packages/core/src/rbac/
 * permissions.ts) chỉ dùng `global`/không-cấp cho `patient.*` nên giới hạn này chưa có tác động
 * thật; chỉ trở thành vấn đề nếu `clinic_admin` tự cấu hình vai trò tuỳ biến gán `personal`/
 * `department` cho `patient.*` qua ADM-07 (P1, chưa hiện thực).
 */
@Injectable()
export class PermissionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly unitOfWork: UnitOfWorkService,
    private readonly breakGlassService: BreakGlassService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const metadata = this.reflector.get<PermissionMetadata | undefined>(PERMISSION_METADATA_KEY, context.getHandler());
    if (!metadata) {
      return true;
    }

    const req = context.switchToHttp().getRequest<Request>();
    if (!req.user) {
      // Không thể xảy ra nếu route đã có JwtAuthGuard chạy trước — fail closed nếu ai đó quên gắn.
      throw new UnauthorizedException();
    }
    const { tenantId, userId } = req.user;

    const scope = await this.unitOfWork.runInTenantScope(tenantId, async (tx) => {
      const scopes = await findScopesForUserPermission(tx, tenantId, userId, metadata.module, metadata.action);
      return maxDataScope(scopes);
    });

    if (scope !== 'none') {
      req.dataScope = scope;
      return true;
    }

    const rawEntityId = metadata.entityIdParam ? req.params[metadata.entityIdParam] : undefined;
    const entityId = typeof rawEntityId === 'string' ? rawEntityId : undefined;
    if (entityId) {
      const consumed = await this.breakGlassService.tryConsume(tenantId, userId, metadata.module, entityId, {
        ip: req.ip ?? null,
        userAgent: req.header('user-agent') ?? null,
      });
      if (consumed.granted) {
        req.dataScope = 'global';
        return true;
      }
    }

    throw new ForbiddenException({
      code: 'PERMISSION_DENIED',
      message: 'Bạn không có quyền thực hiện thao tác này.',
      breakGlassAvailable: true,
    });
  }
}
