import type { DataScope } from '@nexamed/shared';

export {};

declare global {
  namespace Express {
    interface Request {
      /** Set bởi JwtAuthGuard sau khi verify access token — chưa có controller nào dùng ở S1-04. */
      user?: { userId: string; tenantId: string };
      /**
       * Scope đã được `PermissionGuard` xác nhận cho request này (`none` không tới được đây —
       * guard chặn hẳn hoặc yêu cầu break-glass, xem permission.guard.ts). Service/repository đọc
       * giá trị này để biết có cần lọc theo `owner`/`department` hay không (S2-01: `patient`
       * không có khái niệm chủ sở hữu nên mọi scope khác `none` đều coi như `global`).
       */
      dataScope?: DataScope;
    }
  }
}
