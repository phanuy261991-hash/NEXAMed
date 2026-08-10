/**
 * Break-glass (phá kính) — xem .claude/docs/security-audit.md mục Break-glass. Thời hạn phiên
 * cấu hình được qua `tenant_setting` key `break_glass_duration_minutes`; 120 phút là mặc định
 * khi tenant chưa cấu hình — xem .claude/docs/data-model.md.
 */
export const DEFAULT_BREAK_GLASS_DURATION_MINUTES = 120;

export function computeExpiresAt(occurredAt: Date, durationMinutes: number): Date {
  return new Date(occurredAt.getTime() + durationMinutes * 60 * 1000);
}

export function isSessionActive(session: { expiresAt: Date }, now: Date): boolean {
  return session.expiresAt.getTime() > now.getTime();
}
