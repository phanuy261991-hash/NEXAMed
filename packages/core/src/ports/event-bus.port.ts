/**
 * Domain event nội bộ giữa các module — xem .claude/docs/architecture.md mục "Luồng nghiệp vụ
 * v1" và .claude/docs/coding-standards.md mục Event. Tên event dạng `<domain>.<động từ quá
 * khứ>` (`encounter.checked_in`). v1 adapter chạy in-memory, đồng bộ trong transaction của
 * service gọi `publish` (`apps/api/src/infrastructure/eventbus/in-memory.adapter.ts`) — handler
 * lỗi thì rollback thao tác gốc. Payload chỉ chứa ID và dữ liệu tối thiểu, không nhét cả entity.
 * Viết handler idempotent ngay từ v1 để chuyển sang message broker (RabbitMQ/Kafka) sau này
 * không phải sửa lại.
 */
export interface DomainEvent<TPayload = Record<string, unknown>> {
  name: string;
  tenantId: string;
  occurredAt: Date;
  payload: TPayload;
}

export type DomainEventHandler<TPayload = Record<string, unknown>> = (event: DomainEvent<TPayload>) => Promise<void>;

export interface EventBusPort {
  publish(event: DomainEvent): Promise<void>;
  subscribe(eventName: string, handler: DomainEventHandler): void;
}

export const EVENT_BUS_PORT = Symbol('EVENT_BUS_PORT');
