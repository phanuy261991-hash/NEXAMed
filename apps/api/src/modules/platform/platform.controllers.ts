import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request } from 'express';
import {
  createPlatformTenantRequestSchema,
  listPlatformAuditQuerySchema,
  listPlatformTenantsQuerySchema,
  platformLoginRequestSchema,
  platformVerifyOtpRequestSchema,
  suspendPlatformTenantRequestSchema,
  unsuspendPlatformTenantRequestSchema,
  updatePlatformTenantRequestSchema,
} from '@nexamed/shared';
import { extractRequestMeta } from '../../common/request-meta';
import { PlatformAuditService } from './platform-audit.service';
import { PlatformAuthService } from './platform-auth.service';
import { PlatformTenantService } from './platform-tenant.service';
import { PlatformAuthGuard, PlatformHostGuard } from './platform.guards';

/**
 * Đăng nhập khu quản trị nền tảng (docs/DECISIONS.md #237): mật khẩu rồi OTP. Chỉ trả lời trên tên miền phụ quản trị của hệ thống SaaS (`PlatformHostGuard`, nơi khác 404).
 * Đăng nhập chống dò mật khẩu bằng `ThrottlerGuard` (theo IP) cộng khoá tạm theo tài khoản (5 lần sai/15 phút).
 */
@Controller('platform/auth')
@UseGuards(PlatformHostGuard)
export class PlatformAuthController {
  constructor(private readonly auth: PlatformAuthService) {}

  @Post('login')
  @UseGuards(ThrottlerGuard)
  @HttpCode(200)
  async login(@Body() body: unknown, @Req() req: Request) {
    return this.auth.login(platformLoginRequestSchema.parse(body), extractRequestMeta(req));
  }

  @Post('verify-otp')
  @UseGuards(ThrottlerGuard)
  @HttpCode(200)
  async verifyOtp(@Body() body: unknown, @Req() req: Request) {
    return this.auth.verifyOtp(platformVerifyOtpRequestSchema.parse(body), extractRequestMeta(req));
  }

  /** Người vận hành hiện tại — web gọi lúc mở lại trang để biết token còn hiệu lực. */
  @Get('me')
  @UseGuards(PlatformAuthGuard)
  async me(@Req() req: Request) {
    return req.platformOperator!;
  }
}

/** Quản lý công ty khách hàng + nhật ký vận hành. Mọi route: đúng tên miền quản trị + người vận hành đã đăng nhập (OTP). */
@Controller('platform')
@UseGuards(PlatformHostGuard, PlatformAuthGuard)
export class PlatformTenantController {
  constructor(
    private readonly tenants: PlatformTenantService,
    private readonly audit: PlatformAuditService,
  ) {}

  @Get('tenants')
  async list(@Query() query: unknown) {
    return this.tenants.list(listPlatformTenantsQuerySchema.parse(query));
  }

  @Post('tenants')
  @HttpCode(200)
  async create(@Body() body: unknown, @Req() req: Request) {
    return this.tenants.create(createPlatformTenantRequestSchema.parse(body), req.platformOperator!.id, extractRequestMeta(req));
  }

  @Get('tenants/:id')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    return this.tenants.get(id);
  }

  @Patch('tenants/:id')
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: Request) {
    return this.tenants.update(id, updatePlatformTenantRequestSchema.parse(body), req.platformOperator!.id, extractRequestMeta(req));
  }

  @Post('tenants/:id/suspend')
  @HttpCode(200)
  async suspend(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: Request) {
    return this.tenants.suspend(id, suspendPlatformTenantRequestSchema.parse(body), req.platformOperator!.id, extractRequestMeta(req));
  }

  @Post('tenants/:id/unsuspend')
  @HttpCode(200)
  async unsuspend(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: Request) {
    return this.tenants.unsuspend(id, unsuspendPlatformTenantRequestSchema.parse(body), req.platformOperator!.id, extractRequestMeta(req));
  }

  @Post('tenants/:id/reset-admin-password')
  @HttpCode(200)
  async resetAdminPassword(@Param('id', ParseUUIDPipe) id: string, @Req() req: Request) {
    return this.tenants.resetAdminPassword(id, req.platformOperator!.id, extractRequestMeta(req));
  }

  @Get('audit-logs')
  async auditLogs(@Query() query: unknown) {
    return this.audit.list(listPlatformAuditQuerySchema.parse(query));
  }
}
