import { CanActivate, ExecutionContext, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { TenantHostService } from '../tenant-context/tenant-host.service';
import { PlatformAuthService } from './platform-auth.service';

/**
 * Khu quản trị nền tảng chỉ tồn tại trên tên miền phụ quản trị (`admin.<tên miền gốc>`) của hệ thống SaaS (docs/DECISIONS.md #237). Chế độ một công ty, hoặc truy cập từ tên miền phụ của một
 * công ty khách, hoặc tên miền lạ → 404 như thể đường dẫn không tồn tại. Đặt TRƯỚC `PlatformAuthGuard`.
 */
@Injectable()
export class PlatformHostGuard implements CanActivate {
  constructor(private readonly hostService: TenantHostService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<Request>();
    if (!this.hostService.isSaas() || this.hostService.resolveRequestHost(req).kind !== 'platform') throw new NotFoundException();
    return true;
  }
}

/** Xác thực người vận hành bằng access token riêng (`typ: platform_access`). Token phòng khám không qua được và ngược lại. */
@Injectable()
export class PlatformAuthGuard implements CanActivate {
  constructor(private readonly auth: PlatformAuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const header = req.header('authorization');
    const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;
    if (!token) throw new UnauthorizedException();
    const operator = await this.auth.authenticate(token);
    if (!operator) throw new UnauthorizedException();
    req.platformOperator = operator;
    return true;
  }
}
