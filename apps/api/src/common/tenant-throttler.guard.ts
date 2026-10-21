import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Giới hạn tần suất tính theo (IP + CÔNG TY) thay vì chỉ IP (docs/DECISIONS.md #244).
 *
 * Lỗi thật đã kiểm chứng 21/10/2026 ở chế độ SaaS: `ThrottlerGuard` mặc định khoá theo `req.ip`, mà sau reverse proxy MỌI người dùng của MỌI công ty đều có chung một IP
 * (của proxy). Hậu quả: một người gõ sai mật khẩu 10 lần là chặn luôn đăng nhập của tất cả các công ty khác trên cùng hệ thống — chỉ cần một người lạ cũng làm tê liệt
 * được cả nền tảng. Thêm mã công ty vào khoá đếm nên mỗi công ty có hạn mức riêng.
 *
 * Mã công ty lấy từ thân yêu cầu đăng nhập (hoặc token đã xác thực). Người lạ tự bịa mã công ty KHÔNG giúp dò mật khẩu (tài khoản chỉ thuộc đúng một công ty, mã sai thì
 * không có tài khoản nào khớp) — chỉ tạo thêm ô đếm rỗng, mỗi ô tự hết hạn sau đúng cửa sổ giới hạn. Chỉ nhận mã đúng dạng UUID để không nhận chuỗi rác dài làm khoá.
 * Lưu ý: muốn khoá theo ĐÚNG máy trạm thì còn cần đặt `TRUST_PROXY_HOPS` (xem `env.schema.ts`), nếu không mọi máy trong cùng một phòng khám vẫn dùng chung hạn mức.
 */
@Injectable()
export class TenantThrottlerGuard extends ThrottlerGuard {
  protected override async getTracker(req: Record<string, unknown>): Promise<string> {
    const ip = await super.getTracker(req);
    const body = req.body as { tenantId?: unknown } | undefined;
    const user = req.user as { tenantId?: unknown } | undefined;
    const raw = typeof body?.tenantId === 'string' ? body.tenantId : typeof user?.tenantId === 'string' ? user.tenantId : null;
    const tenantId = raw && UUID_PATTERN.test(raw) ? raw : 'khong-xac-dinh';
    return `${ip}|${tenantId}`;
  }
}
