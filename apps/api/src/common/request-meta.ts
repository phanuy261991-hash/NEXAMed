import type { Request } from 'express';

/**
 * `{ip, userAgent}` cho `writeAuditLog`/`NotificationPort` — trùng lặp lần thứ ba (đã có ở
 * `auth.service.ts`, `break-glass.service.ts` trước khi patient module ra đời) nên trích xuất
 * dùng chung theo .claude/docs/coding-standards.md. Hai chỗ cũ giữ nguyên định nghĩa cục bộ của
 * chúng (đã test kỹ từ S1-04/S1-04c, không đổi lại chỉ để dedup thuần tuý) — module mới từ đây
 * trở đi dùng hàm này.
 */
export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

export function extractRequestMeta(req: Request): RequestMeta {
  return { ip: req.ip ?? null, userAgent: req.header('user-agent') ?? null };
}
