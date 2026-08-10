import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { jwtPayloadSchema } from '@nexamed/shared';
import { tenantContextStorage } from '../infrastructure/persistence/tenant-context.store';

/**
 * S1-04: đọc tenantId/actorId từ access token JWT đã xác thực (Authorization: Bearer), thay
 * cho header không xác thực dùng tạm ở S1-03 — theo cam kết trong docs/DECISIONS.md #012.
 *
 * Không có/token sai/hết hạn/sai `typ` → không set gì (fail open ở tầng middleware này), vẫn
 * fail closed ở tầng RLS/UnitOfWorkService phía sau (đã xác minh bằng tenant-isolation.spec.ts)
 * và ở JwtAuthGuard cho route bắt buộc đăng nhập — không phải lớp phòng thủ duy nhất, xem
 * .claude/docs/security-audit.md ("quyền kiểm ở tầng service/repository, không chỉ một chỗ").
 * `/auth/login` và `/auth/refresh` không đi qua access token (chưa đăng nhập, hoặc dùng refresh
 * token) nên tự quản lý tenant scope riêng trong AuthService — không phụ thuộc middleware này.
 */
@Injectable()
export class TenantContextMiddleware implements NestMiddleware {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  use(req: Request, _res: Response, next: NextFunction) {
    const header = req.header('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;

    let tenantId: string | undefined;
    let actorId: string | undefined;

    if (token) {
      try {
        const decoded: unknown = this.jwtService.verify(token, {
          secret: this.configService.getOrThrow<string>('JWT_SECRET'),
        });
        const parsed = jwtPayloadSchema.safeParse(decoded);
        if (parsed.success && parsed.data.typ === 'access') {
          tenantId = parsed.data.tenantId;
          actorId = parsed.data.sub;
        }
      } catch {
        // Token sai/hết hạn — bỏ qua, coi như không có tenant context (fail closed ở RLS/guard).
      }
    }

    tenantContextStorage.run({ tenantId, actorId }, () => next());
  }
}