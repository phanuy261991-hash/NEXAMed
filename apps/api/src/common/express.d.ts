import type { DataScope } from '@nexamed/shared';

export {};

declare global {
  namespace Express {
    interface Request {
      /** Set bởi JwtAuthGuard sau khi verify access token — chưa có controller nào dùng ở S1-04. */
      /**
       * `branchId` = chi nhánh đang làm việc của phiên (docs/DECISIONS.md #231), lấy từ claim `bid` của access token; `null` = chưa chọn.
       * Mọi service dữ liệu theo địa điểm đọc qua `requireBranchId(req.user)` (common/branch-context.ts), không tự đọc claim.
       */
      user?: { userId: string; tenantId: string; branchId: string | null };
      /**
       * Scope đã được `PermissionGuard` xác nhận cho request này (`none` không tới được đây —
       * guard chặn hẳn hoặc yêu cầu break-glass, xem permission.guard.ts). Service/repository đọc
       * giá trị này để biết có cần lọc theo `owner`/`department` hay không (S2-01: `patient`
       * không có khái niệm chủ sở hữu nên mọi scope khác `none` đều coi như `global`).
       */
      dataScope?: DataScope;
      /**
       * Chế độ SaaS (docs/DECISIONS.md #237): `TenantContextMiddleware` đặt `true` khi request mang access token nhưng token KHÔNG thuộc công ty của tên miền phụ đang truy cập, hoặc công ty đang tạm ngưng.
       * `JwtAuthGuard` coi đó là chưa xác thực (401). Không bao giờ đặt ở chế độ một công ty.
       */
      tenantRejected?: boolean;
      /** Người vận hành nền tảng đã xác thực (`PlatformAuthGuard`, docs/DECISIONS.md #237) — chỉ có trên khu quản trị nền tảng, tách hẳn `user` của phòng khám. */
      platformOperator?: { id: string; username: string; fullName: string };
    }
  }
}
