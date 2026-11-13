import { describe, expect, it } from 'vitest';
import type { PurchaseOrderStatus } from '@nexamed/shared';
import { canReceiveOrder, ORDER_STATUS_META, ORDER_STATUS_ORDER, orderActionsFor, orderStepState } from './purchase-order-meta';

describe('purchase-order-meta', () => {
  it('mọi trạng thái đều có nhãn và nằm trong thứ tự dải đếm', () => {
    const all: PurchaseOrderStatus[] = ['DRAFT', 'PENDING_APPROVAL', 'REJECTED', 'APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED'];
    for (const s of all) {
      expect(ORDER_STATUS_META[s].label.length).toBeGreaterThan(0);
      expect(ORDER_STATUS_ORDER).toContain(s);
    }
    expect(ORDER_STATUS_ORDER).toHaveLength(all.length);
  });

  it('dải bước: Đã nhận đủ thì mọi bước xong; Nhận một phần thì bước đó là hiện tại; chưa duyệt thì chưa có bước nào', () => {
    expect(orderStepState('RECEIVED', 'RECEIVED')).toBe('done');
    expect(orderStepState('RECEIVED', 'APPROVED')).toBe('done');
    expect(orderStepState('PARTIALLY_RECEIVED', 'PARTIALLY_RECEIVED')).toBe('current');
    expect(orderStepState('PARTIALLY_RECEIVED', 'ORDERED')).toBe('done');
    expect(orderStepState('PARTIALLY_RECEIVED', 'RECEIVED')).toBe('todo');
    expect(orderStepState('ORDERED', 'ORDERED')).toBe('current');
    expect(orderStepState('PENDING_APPROVAL', 'APPROVED')).toBe('todo');
  });

  it('nút theo trạng thái khớp ma trận ở máy chủ', () => {
    expect(orderActionsFor('DRAFT')).toMatchObject({ edit: true, submit: true, approve: true, reject: false, order: false, receive: false, cancel: true });
    expect(orderActionsFor('PENDING_APPROVAL')).toMatchObject({ edit: false, approve: true, reject: true, cancel: true });
    expect(orderActionsFor('APPROVED')).toMatchObject({ order: true, cancel: true });
    expect(orderActionsFor('ORDERED')).toMatchObject({ receive: true, close: true, cancel: true });
    expect(orderActionsFor('PARTIALLY_RECEIVED')).toMatchObject({ receive: true, close: true, cancel: false });
    expect(orderActionsFor('RECEIVED')).toMatchObject({ receive: false, close: false, cancel: false });
    expect(canReceiveOrder('ORDERED')).toBe(true);
    expect(canReceiveOrder('RECEIVED')).toBe(false);
  });
});
