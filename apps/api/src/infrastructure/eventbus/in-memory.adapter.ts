import { Injectable, Logger } from '@nestjs/common';
import type { DomainEvent, DomainEventHandler, EventBusPort } from '@nexamed/core';

/**
 * Adapter v1 cho EventBusPort — in-memory, `publish` chạy tuần tự và đồng bộ (await từng
 * handler), nên khi service gọi `publish` bên trong transaction, handler lỗi ném lên và làm
 * rollback thao tác gốc, đúng quy tắc ở .claude/docs/coding-standards.md mục Event. Đăng ký
 * handler (`subscribe`) là wiring cấu hình lúc khởi động module, không phải state nghiệp vụ theo
 * request — không vi phạm nguyên tắc "không lưu state trong RAM tiến trình" ở project-structure.md.
 * Sau này đổi sang RabbitMQ/Kafka chỉ thay adapter; handler đã viết idempotent từ v1.
 */
@Injectable()
export class InMemoryEventBusAdapter implements EventBusPort {
  private readonly logger = new Logger(InMemoryEventBusAdapter.name);
  private readonly handlers = new Map<string, DomainEventHandler[]>();

  subscribe(eventName: string, handler: DomainEventHandler): void {
    const list = this.handlers.get(eventName) ?? [];
    list.push(handler);
    this.handlers.set(eventName, list);
  }

  async publish(event: DomainEvent): Promise<void> {
    const list = this.handlers.get(event.name) ?? [];
    for (const handler of list) {
      await handler(event);
    }
    this.logger.log(`[event] ${event.name} tenant=${event.tenantId}`);
  }
}
