import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';

/**
 * Chiều ngược lại của `SingleTenantOnlyGuard` (docs/DECISIONS.md #237): endpoint chỉ có ở chế độ SaaS (khu quản trị nền tảng, tra công ty theo tên miền phụ). Ở chế độ một công ty
 * (on-prem/VPS/NAS) trả 404 như thể đường dẫn không tồn tại — máy chủ không bật các endpoint này. Đặt TRƯỚC mọi guard khác trong `@UseGuards`.
 */
@Injectable()
export class SaasOnlyGuard implements CanActivate {
  constructor(private readonly config: ConfigService<Env, true>) {}

  canActivate(): boolean {
    if (this.config.get('DEPLOYMENT_MODE', { infer: true }) !== 'saas') throw new NotFoundException();
    return true;
  }
}
