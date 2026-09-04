import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { breakGlassRequestSchema } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { BreakGlassService } from './break-glass.service';
import type { RequestMeta } from './auth.service';

/**
 * "Phá kính" — TỰ-PHỤC VỤ có chủ đích, KHÔNG gắn `PermissionGuard`/`@RequirePermission` (khác 27/30
 * controller nghiệp vụ còn lại): mục đích của route này CHÍNH LÀ cấp quyền tạm thời cho actor
 * vốn KHÔNG có permission cần dùng — đòi hỏi chính permission đó ở đây sẽ tự loại trừ lẫn nhau.
 * An toàn không phải nhờ RBAC mà nhờ xác thực lại mật khẩu (step-up auth, `argon2.verify` trong
 * `BreakGlassService.request()`) + ghi `audit_log` + `ThrottlerGuard` — xem
 * .claude/docs/security-audit.md mục Break-glass.
 */
@Controller('break-glass')
@UseGuards(JwtAuthGuard)
export class BreakGlassController {
  constructor(private readonly breakGlassService: BreakGlassService) {}

  @Post()
  @UseGuards(ThrottlerGuard)
  @HttpCode(200)
  async request(@Body() body: unknown, @Req() req: Request) {
    const dto = breakGlassRequestSchema.parse(body);
    // req.user luôn có giá trị ở đây — JwtAuthGuard đã throw UnauthorizedException trước đó nếu thiếu.
    const { userId, tenantId } = req.user!;
    const result = await this.breakGlassService.request({ tenantId, actorId: userId }, dto, this.requestMeta(req));
    return { expiresAt: result.expiresAt };
  }

  private requestMeta(req: Request): RequestMeta {
    return { ip: req.ip ?? null, userAgent: req.header('user-agent') ?? null };
  }
}
