import { Body, Controller, Get, HttpCode, Post, Req, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { changePasswordRequestSchema, loginRequestSchema } from '@nexamed/shared';
import { RefreshTokenInvalidError } from '@nexamed/core';
import { JwtAuthGuard } from '../../common/jwt-auth.guard';
import { AuthService, type RequestMeta } from './auth.service';

const REFRESH_COOKIE_NAME = 'refresh_token';
const REFRESH_COOKIE_PATH = '/api/v1/auth';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Post('login')
  @UseGuards(ThrottlerGuard)
  @HttpCode(200)
  async login(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const dto = loginRequestSchema.parse(body);
    const result = await this.authService.login(dto, this.requestMeta(req));
    this.setRefreshCookie(res, result.refreshToken, result.refreshExpiresIn);
    return { accessToken: result.accessToken, expiresIn: result.expiresIn, user: result.user };
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = this.readRefreshCookie(req);
    if (!token) {
      throw new RefreshTokenInvalidError();
    }
    const result = await this.authService.refresh(token, this.requestMeta(req));
    this.setRefreshCookie(res, result.refreshToken, result.refreshExpiresIn);
    return { accessToken: result.accessToken, expiresIn: result.expiresIn };
  }

  @Post('logout')
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = this.readRefreshCookie(req);
    await this.authService.logout(token, this.requestMeta(req));
    res.clearCookie(REFRESH_COOKIE_NAME, { path: REFRESH_COOKIE_PATH });
    return { success: true };
  }

  /**
   * Danh tính + vai trò của user đang đăng nhập — web gọi sau khi khôi phục phiên qua
   * `/auth/refresh` lúc reload trang (chỉ có access token mới, chưa có `user`/`roles` trong bộ
   * nhớ). Xem docs/DECISIONS.md #022.
   */
  @Get('me')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  async me(@Req() req: Request) {
    // req.user luôn có giá trị ở đây — JwtAuthGuard đã throw UnauthorizedException trước đó nếu thiếu.
    const { userId, tenantId } = req.user!;
    return this.authService.getCurrentUser(tenantId, userId);
  }

  /**
   * Tự đổi mật khẩu (mở rộng ADM-01) — chỉ `JwtAuthGuard`, KHÔNG `PermissionGuard`: tự đổi mật
   * khẩu của chính mình không phải thao tác quản trị, mọi vai trò đều tự phục vụ được (cùng
   * nguyên tắc `/auth/me`, khác `POST /users/:id/reset-password` — thao tác admin đổi hộ người
   * khác, bắt buộc `user_account.manage`).
   */
  @Post('change-password')
  @UseGuards(JwtAuthGuard)
  @HttpCode(200)
  async changePassword(@Body() body: unknown, @Req() req: Request) {
    const dto = changePasswordRequestSchema.parse(body);
    const { userId, tenantId } = req.user!;
    await this.authService.changePassword(tenantId, userId, dto, this.requestMeta(req));
    return { success: true };
  }

  private readRefreshCookie(req: Request): string | undefined {
    const cookies = req.cookies as Record<string, string | undefined> | undefined;
    return cookies?.[REFRESH_COOKIE_NAME];
  }

  private setRefreshCookie(res: Response, token: string, expiresInSeconds: number): void {
    res.cookie(REFRESH_COOKIE_NAME, token, {
      httpOnly: true,
      secure: this.isCookieSecure(),
      sameSite: 'lax',
      path: REFRESH_COOKIE_PATH,
      maxAge: expiresInSeconds * 1000,
    });
  }

  /**
   * Cờ `Secure` KHÔNG suy ra thẳng từ `NODE_ENV` — trình duyệt âm thầm bỏ qua cookie `Secure`
   * trên origin `http://` (không báo lỗi), khiến refresh hỏng không dấu vết trên bản on-prem
   * PC/NAS mặc định chạy HTTP thuần (`docs/Deploy.md` Phần 0.2). `COOKIE_SECURE` cho phép chỉnh
   * tường minh độc lập với môi trường; không đặt thì giữ hành vi cũ (production → secure).
   */
  private isCookieSecure(): boolean {
    const override = this.configService.get<'true' | 'false' | undefined>('COOKIE_SECURE');
    if (override !== undefined) return override === 'true';
    return this.configService.get<string>('NODE_ENV') === 'production';
  }

  private requestMeta(req: Request): RequestMeta {
    return { ip: req.ip ?? null, userAgent: req.header('user-agent') ?? null };
  }
}
