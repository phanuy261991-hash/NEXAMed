import { Injectable, Logger } from '@nestjs/common';
import type { NotificationPayload, NotificationPort } from '@nexamed/core';

/**
 * Adapter no-op cho v1 — chỉ ghi log, không gửi SMS/Zalo/email thật. Xem .claude/docs/
 * project-structure.md (bảng port/adapter) và docs/DECISIONS.md #015. Chỉ log `tenantId`/
 * `type`/`metadata` (id, không phải PII) — không log `message` nếu sau này chứa nội dung nhạy
 * cảm; hiện tại message là mô tả nghiệp vụ chung chung, không phải dữ liệu bệnh nhân.
 */
@Injectable()
export class NoopNotificationAdapter implements NotificationPort {
  private readonly logger = new Logger(NoopNotificationAdapter.name);

  async send(payload: NotificationPayload): Promise<void> {
    this.logger.log(`[no-op] ${payload.type} tenant=${payload.tenantId}`);
  }
}
