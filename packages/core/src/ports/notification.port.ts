/**
 * Gửi thông báo ra ngoài hệ thống (SMS/Zalo/email...) — xem .claude/docs/project-structure.md
 * bảng Port/adapter. v1 chỉ có adapter no-op (`apps/api/src/infrastructure/notification/
 * noop.adapter.ts`), chỉ ghi log. Hình dạng tối thiểu đủ dùng cho break-glass (S1-04c) —
 * chưa thiết kế trước cho nhắc lịch SMS/Zalo (ADM-07/APP-07), mở rộng khi tới lượt.
 */
export interface NotificationPayload {
  tenantId: string;
  type: string;
  message: string;
  metadata?: Record<string, unknown>;
}

export interface NotificationPort {
  send(payload: NotificationPayload): Promise<void>;
}

export const NOTIFICATION_PORT = Symbol('NOTIFICATION_PORT');
