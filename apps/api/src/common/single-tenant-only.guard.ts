import { CanActivate, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../config/env.schema';

/**
 * Chốt chặn theo chế độ triển khai (docs/DECISIONS.md #236): endpoint chỉ có ý nghĩa khi hệ thống phục vụ MỘT công ty (on-prem/VPS/NAS, `DEPLOYMENT_MODE=single`)
 * — ví dụ cập nhật phần mềm của chính máy chủ đó. Ở chế độ `saas` (nhiều công ty dùng chung) trả 404 như thể đường dẫn không tồn tại, để một công ty không thể
 * chạm vào việc vận hành chung của cả hệ thống. Đặt TRƯỚC `JwtAuthGuard` trong `@UseGuards` để người chưa đăng nhập cũng không phân biệt được "không có" với "không được phép".
 */
@Injectable()
export class SingleTenantOnlyGuard implements CanActivate {
  constructor(private readonly config: ConfigService<Env, true>) {}

  canActivate(): boolean {
    if (this.config.get('DEPLOYMENT_MODE', { infer: true }) === 'saas') throw new NotFoundException();
    return true;
  }
}
