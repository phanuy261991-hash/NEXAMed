import { describe, expect, it } from 'vitest';
import type { DomainEvent } from '@nexamed/core';
import { InMemoryEventBusAdapter } from './in-memory.adapter';

describe('InMemoryEventBusAdapter', () => {
  it('publish gọi đúng handler đã subscribe theo tên event, đúng thứ tự', async () => {
    const bus = new InMemoryEventBusAdapter();
    const calls: string[] = [];
    bus.subscribe('encounter.checked_in', async () => {
      calls.push('handler-1');
    });
    bus.subscribe('encounter.checked_in', async () => {
      calls.push('handler-2');
    });
    bus.subscribe('encounter.completed', async () => {
      calls.push('handler-khac');
    });

    const event: DomainEvent = {
      name: 'encounter.checked_in',
      tenantId: 'tenant-a',
      occurredAt: new Date(),
      payload: { encounterId: 'e1' },
    };
    await bus.publish(event);

    expect(calls).toEqual(['handler-1', 'handler-2']);
  });

  it('publish event không có handler nào thì không lỗi', async () => {
    const bus = new InMemoryEventBusAdapter();
    await expect(
      bus.publish({ name: 'khong.ai.nghe', tenantId: 'tenant-a', occurredAt: new Date(), payload: {} }),
    ).resolves.toBeUndefined();
  });

  it('handler lỗi thì publish ném lỗi lên (để service rollback transaction)', async () => {
    const bus = new InMemoryEventBusAdapter();
    bus.subscribe('appointment.created', async () => {
      throw new Error('handler lỗi');
    });

    await expect(
      bus.publish({ name: 'appointment.created', tenantId: 'tenant-a', occurredAt: new Date(), payload: {} }),
    ).rejects.toThrow('handler lỗi');
  });
});
