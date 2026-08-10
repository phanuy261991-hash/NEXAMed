export {};

declare global {
  namespace Express {
    interface Request {
      /** Set bởi JwtAuthGuard sau khi verify access token — chưa có controller nào dùng ở S1-04. */
      user?: { userId: string; tenantId: string };
    }
  }
}
