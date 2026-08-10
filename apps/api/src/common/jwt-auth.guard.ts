import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { jwtPayloadSchema } from '@nexamed/shared';

/**
 * Guard xác thực tối thiểu: có access token hợp lệ hay không. Chưa kiểm data_scope/permission
 * (đó là guard riêng của S2, đọc role_permission — xem docs/CURRENT.md). Chưa áp vào controller
 * nghiệp vụ nào ở S1-04 (chưa có controller nào cần) — viết + test sẵn cho S2 dùng ngay, giống
 * cách các adapter no-op được chuẩn bị trước trong .claude/docs/project-structure.md.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const header = request.header('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;

    if (!token) {
      throw new UnauthorizedException();
    }

    try {
      const decoded: unknown = this.jwtService.verify(token, {
        secret: this.configService.getOrThrow<string>('JWT_SECRET'),
      });
      const parsed = jwtPayloadSchema.safeParse(decoded);
      if (!parsed.success || parsed.data.typ !== 'access') {
        throw new UnauthorizedException();
      }
      request.user = { userId: parsed.data.sub, tenantId: parsed.data.tenantId };
      return true;
    } catch {
      throw new UnauthorizedException();
    }
  }
}
