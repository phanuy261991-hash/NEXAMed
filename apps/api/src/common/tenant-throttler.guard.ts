import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { ipTenantTracker } from './throttle-trackers';

/**
 * Guard giới hạn tần suất dùng chung. Khoá đếm KHÔNG còn một cách tính duy nhất theo IP (docs/DECISIONS.md #258, sửa #244): từng giới hạn khai báo `getTracker` riêng ở `ThrottlerModule`
 * (`iam.module.ts`, hàm ở `throttle-trackers.ts`) — đăng nhập theo tài khoản + theo IP, tra cứu bệnh nhân theo người dùng. Hàm dưới đây chỉ là mặc định cho giới hạn nào không tự khai báo.
 *
 * Lịch sử #244: `ThrottlerGuard` mặc định khoá theo `req.ip`, mà sau reverse proxy MỌI người dùng của MỌI công ty chung một IP — một người gõ sai mật khẩu chặn cả hệ thống; nên mã công ty
 * luôn nằm trong khoá. Muốn khoá theo ĐÚNG máy trạm thì cần `TRUST_PROXY_HOPS` (xem `env.schema.ts`); riêng PC Windows chạy Docker Desktop vẫn che IP máy trạm (đo thật 23/10/2026)
 * nên đừng dựa vào IP một mình.
 */
@Injectable()
export class TenantThrottlerGuard extends ThrottlerGuard {
  protected override getTracker(req: Record<string, unknown>): Promise<string> {
    return Promise.resolve(ipTenantTracker(req));
  }
}
