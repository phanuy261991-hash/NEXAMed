import { describe, expect, it } from 'vitest';
import {
  canPerformPurchaseOrderAction,
  computePurchaseOrderTotal,
  derivePurchaseOrderStatusFromReceipts,
  isPurchaseOrderApproverBranch,
  isPurchaseOrderPlaced,
  isReceiptQtyWithinOrder,
  purchaseOrderRemainingQty,
  requiresMainBranchApproval,
  type PurchaseOrderStatusValue,
} from './purchase-order-state';

describe('canPerformPurchaseOrderAction', () => {
  it('sửa / gửi duyệt chỉ ở Nháp (sửa còn cả Từ chối)', () => {
    expect(canPerformPurchaseOrderAction('DRAFT', 'update')).toBe(true);
    expect(canPerformPurchaseOrderAction('REJECTED', 'update')).toBe(true);
    expect(canPerformPurchaseOrderAction('PENDING_APPROVAL', 'update')).toBe(false);
    expect(canPerformPurchaseOrderAction('DRAFT', 'submit')).toBe(true);
    expect(canPerformPurchaseOrderAction('REJECTED', 'submit')).toBe(false);
  });

  it('duyệt ở Nháp (tự duyệt) hoặc Chờ duyệt; từ chối chỉ ở Chờ duyệt; gửi NCC chỉ ở Đã duyệt', () => {
    expect(canPerformPurchaseOrderAction('DRAFT', 'approve')).toBe(true);
    expect(canPerformPurchaseOrderAction('PENDING_APPROVAL', 'approve')).toBe(true);
    expect(canPerformPurchaseOrderAction('APPROVED', 'approve')).toBe(false);
    expect(canPerformPurchaseOrderAction('DRAFT', 'reject')).toBe(false);
    expect(canPerformPurchaseOrderAction('PENDING_APPROVAL', 'reject')).toBe(true);
    expect(canPerformPurchaseOrderAction('APPROVED', 'order')).toBe(true);
    expect(canPerformPurchaseOrderAction('ORDERED', 'order')).toBe(false);
  });

  it('nhận hàng và đóng đơn chỉ khi đã đặt NCC và chưa nhận đủ', () => {
    for (const s of ['ORDERED', 'PARTIALLY_RECEIVED'] as const) {
      expect(canPerformPurchaseOrderAction(s, 'receive')).toBe(true);
      expect(canPerformPurchaseOrderAction(s, 'close')).toBe(true);
    }
    for (const s of ['DRAFT', 'APPROVED', 'RECEIVED', 'CLOSED', 'CANCELLED'] as const) {
      expect(canPerformPurchaseOrderAction(s, 'receive')).toBe(false);
      expect(canPerformPurchaseOrderAction(s, 'close')).toBe(false);
    }
  });

  it('huỷ được trước khi nhận hàng, không huỷ được đơn đã nhận / đã đóng / đã huỷ', () => {
    for (const s of ['DRAFT', 'PENDING_APPROVAL', 'REJECTED', 'APPROVED', 'ORDERED'] as const) expect(canPerformPurchaseOrderAction(s, 'cancel')).toBe(true);
    for (const s of ['PARTIALLY_RECEIVED', 'RECEIVED', 'CLOSED', 'CANCELLED'] as const) expect(canPerformPurchaseOrderAction(s, 'cancel')).toBe(false);
  });
});

describe('phía duyệt theo chi nhánh', () => {
  it('chỉ đơn của chi nhánh phụ khi công tắc bật mới cần chi nhánh chính duyệt', () => {
    expect(requiresMainBranchApproval({ needsMainApprovalSetting: true, orderBranchIsMain: false })).toBe(true);
    expect(requiresMainBranchApproval({ needsMainApprovalSetting: true, orderBranchIsMain: true })).toBe(false);
    expect(requiresMainBranchApproval({ needsMainApprovalSetting: false, orderBranchIsMain: false })).toBe(false);
  });

  it('đơn cần chi nhánh chính duyệt → người duyệt phải ở chi nhánh chính; ngược lại phải cùng chi nhánh với đơn', () => {
    expect(isPurchaseOrderApproverBranch({ requiresMainApproval: true, viewerBranchId: 'A', viewerBranchIsMain: true, orderBranchId: 'B' })).toBe(true);
    expect(isPurchaseOrderApproverBranch({ requiresMainApproval: true, viewerBranchId: 'B', viewerBranchIsMain: false, orderBranchId: 'B' })).toBe(false);
    expect(isPurchaseOrderApproverBranch({ requiresMainApproval: false, viewerBranchId: 'B', viewerBranchIsMain: false, orderBranchId: 'B' })).toBe(true);
    expect(isPurchaseOrderApproverBranch({ requiresMainApproval: false, viewerBranchId: 'A', viewerBranchIsMain: true, orderBranchId: 'B' })).toBe(false);
  });
});

describe('trạng thái đơn theo số đã nhận', () => {
  const lines = (pairs: [number, number][]) => pairs.map(([orderedQty, receivedQty]) => ({ orderedQty, receivedQty }));

  it('đủ mọi dòng → Đã nhận đủ; có nhận chưa đủ → Nhận một phần; chưa nhận gì → Đã đặt NCC', () => {
    expect(derivePurchaseOrderStatusFromReceipts('ORDERED', lines([[10, 10], [5, 5]]))).toBe('RECEIVED');
    expect(derivePurchaseOrderStatusFromReceipts('ORDERED', lines([[10, 10], [5, 0]]))).toBe('PARTIALLY_RECEIVED');
    expect(derivePurchaseOrderStatusFromReceipts('PARTIALLY_RECEIVED', lines([[10, 0], [5, 0]]))).toBe('ORDERED');
    expect(derivePurchaseOrderStatusFromReceipts('RECEIVED', lines([[10, 4]]))).toBe('PARTIALLY_RECEIVED');
  });

  it('nhận vượt vẫn tính là đã nhận đủ', () => {
    expect(derivePurchaseOrderStatusFromReceipts('ORDERED', lines([[10, 12]]))).toBe('RECEIVED');
  });

  it('đơn chưa đặt NCC / đã đóng / đã huỷ giữ nguyên dù số đã nhận đổi', () => {
    const untouched: PurchaseOrderStatusValue[] = ['DRAFT', 'PENDING_APPROVAL', 'REJECTED', 'APPROVED', 'CLOSED', 'CANCELLED'];
    for (const s of untouched) expect(derivePurchaseOrderStatusFromReceipts(s, lines([[10, 10]]))).toBe(s);
  });

  it('isPurchaseOrderPlaced: chỉ Đã đặt, Nhận một phần, Đã nhận đủ', () => {
    expect(['ORDERED', 'PARTIALLY_RECEIVED', 'RECEIVED'].every((s) => isPurchaseOrderPlaced(s as PurchaseOrderStatusValue))).toBe(true);
    expect(['DRAFT', 'APPROVED', 'CLOSED', 'CANCELLED'].some((s) => isPurchaseOrderPlaced(s as PurchaseOrderStatusValue))).toBe(false);
  });
});

describe('số còn thiếu và nhận vượt', () => {
  it('còn thiếu không âm', () => {
    expect(purchaseOrderRemainingQty(10, 4)).toBe(6);
    expect(purchaseOrderRemainingQty(10, 12)).toBe(0);
  });

  it('nhận vượt bị chặn trừ khi công tắc bật; đúng bằng số còn thiếu thì hợp lệ', () => {
    expect(isReceiptQtyWithinOrder({ orderedQty: 10, receivedQty: 6, receiveQty: 4 }, false)).toBe(true);
    expect(isReceiptQtyWithinOrder({ orderedQty: 10, receivedQty: 6, receiveQty: 5 }, false)).toBe(false);
    expect(isReceiptQtyWithinOrder({ orderedQty: 10, receivedQty: 6, receiveQty: 5 }, true)).toBe(true);
  });
});

describe('computePurchaseOrderTotal', () => {
  it('chỉ cộng dòng có đơn giá', () => {
    expect(
      computePurchaseOrderTotal([
        { quantity: 10, expectedUnitCost: 2000 },
        { quantity: 5, expectedUnitCost: null },
        { quantity: 3, expectedUnitCost: 1500 },
      ]),
    ).toBe(24500);
    expect(computePurchaseOrderTotal([])).toBe(0);
  });
});
