import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import { breakGlassRequestSchema } from '@nexamed/shared';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { BreakGlassService } from './break-glass.service';
import type { RequestMeta } from './auth.service';

@Controller('break-glass')
export class BreakGlassController {
  constructor(private readonly breakGlassService: BreakGlassService) {}

  @Post()
  @UseGuards(JwtAuthGuard, ThrottlerGuard)
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
