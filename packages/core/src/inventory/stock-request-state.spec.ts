import { describe, expect, it } from 'vitest';
import {
  computeLineProgress,
  deriveStockRequestStatus,
  hasAllocation,
  requesterActions,
  resolveSupplyingWarehouseId,
  supplierActions,
  transferPhase,
  type StockRequestLineInput,
} from './stock-request-state';

const line = (over: Partial<StockRequestLineInput> = {}): StockRequestLineInput => ({ fulfilStatus: 'PENDING', requestedQty: 10, transferLines: [], ...over });

describe('transferPhase', () => {
  it('phiếu nháp bị bên gửi từ chối coi như không tồn tại', () => {
    expect(transferPhase('REJECTED')).toBe('VOID');
  });
  it('COMPLETED và RETURNED là xong', () => {
    expect(transferPhase('COMPLETED')).toBe('DONE');
    expect(transferPhase('RETURNED')).toBe('DONE');
  });
});

describe('computeLineProgress', () => {
  it('chưa xử lý: chưa cấp, còn thiếu đủ số xin', () => {
    expect(computeLineProgress(line())).toEqual({ status: 'PENDING', allocatedQty: 0, receivedQty: 0, remainingQty: 10 });
  });
  it('đã cấp một phần và chờ hàng về: giữ trạng thái chờ hàng về, còn thiếu đúng phần chưa cấp', () => {
    const p = computeLineProgress(line({ fulfilStatus: 'WAITING_STOCK', transferLines: [{ transferStatus: 'IN_TRANSIT', quantityShipped: 6, quantityReceived: null }] }));
    expect(p).toEqual({ status: 'WAITING_STOCK', allocatedQty: 6, receivedQty: 0, remainingQty: 4 });
  });
  it('phiếu điều chuyển nháp bị từ chối không tính vào số đã cấp', () => {
    const p = computeLineProgress(line({ fulfilStatus: 'ALLOCATED', transferLines: [{ transferStatus: 'REJECTED', quantityShipped: 10, quantityReceived: null }] }));
    expect(p.allocatedQty).toBe(0);
  });
  it('dòng đã cấp: sẽ cấp → đang giao → đã nhận theo trạng thái phiếu điều chuyển', () => {
    const mk = (transferStatus: 'DRAFT' | 'IN_TRANSIT' | 'COMPLETED', received: number | null) =>
      computeLineProgress(line({ fulfilStatus: 'ALLOCATED', transferLines: [{ transferStatus, quantityShipped: 10, quantityReceived: received }] })).status;
    expect(mk('DRAFT', null)).toBe('WILL_SUPPLY');
    expect(mk('IN_TRANSIT', null)).toBe('IN_TRANSIT');
    expect(mk('COMPLETED', 10)).toBe('RECEIVED');
  });
  it('nhận thiếu: chờ kho cấp xử lý chênh lệch, ưu tiên hơn các phiếu đã xong', () => {
    const p = computeLineProgress(
      line({
        fulfilStatus: 'ALLOCATED',
        transferLines: [
          { transferStatus: 'COMPLETED', quantityShipped: 4, quantityReceived: 4 },
          { transferStatus: 'VARIANCE_PENDING', quantityShipped: 6, quantityReceived: 5 },
        ],
      }),
    );
    expect(p.status).toBe('VARIANCE_PENDING');
    expect(p.receivedQty).toBe(9);
  });
  it('từ chối và rút giữ nguyên trạng thái dòng', () => {
    expect(computeLineProgress(line({ fulfilStatus: 'REJECTED' })).status).toBe('REJECTED');
    expect(computeLineProgress(line({ fulfilStatus: 'WITHDRAWN' })).status).toBe('WITHDRAWN');
  });
});

describe('deriveStockRequestStatus', () => {
  const shipped = (transferStatus: 'DRAFT' | 'IN_TRANSIT' | 'COMPLETED' | 'VARIANCE_PENDING', received: number | null = null) => [
    { transferStatus, quantityShipped: 10, quantityReceived: received },
  ];

  it('không đổi trạng thái trước tiếp nhận và các trạng thái đóng do hành động cả phiếu', () => {
    for (const s of ['DRAFT', 'SUBMITTED', 'REJECTED', 'CANCELLED'] as const) {
      expect(deriveStockRequestStatus(s, [line()])).toBe(s);
    }
  });
  it('đã tiếp nhận mà chưa quyết định dòng nào: ACCEPTED', () => {
    expect(deriveStockRequestStatus('ACCEPTED', [line(), line()])).toBe('ACCEPTED');
  });
  it('có dòng chờ hàng về: IN_PROGRESS dù các dòng khác đã nhận xong', () => {
    const lines = [line({ fulfilStatus: 'ALLOCATED', transferLines: shipped('COMPLETED', 10) }), line({ fulfilStatus: 'WAITING_STOCK' })];
    expect(deriveStockRequestStatus('IN_PROGRESS', lines)).toBe('IN_PROGRESS');
  });
  it('mọi dòng đã nhận xong hoặc đã đóng: COMPLETED', () => {
    const lines = [line({ fulfilStatus: 'ALLOCATED', transferLines: shipped('COMPLETED', 10) }), line({ fulfilStatus: 'REJECTED' }), line({ fulfilStatus: 'WITHDRAWN' })];
    expect(deriveStockRequestStatus('IN_PROGRESS', lines)).toBe('COMPLETED');
  });
  it('còn hàng đang giao: chưa hoàn thành', () => {
    expect(deriveStockRequestStatus('IN_PROGRESS', [line({ fulfilStatus: 'ALLOCATED', transferLines: shipped('IN_TRANSIT') })])).toBe('IN_PROGRESS');
  });
  it('nhận thiếu chờ xử lý chênh lệch: chưa hoàn thành cho tới khi kho cấp xử lý', () => {
    expect(deriveStockRequestStatus('IN_PROGRESS', [line({ fulfilStatus: 'ALLOCATED', transferLines: shipped('VARIANCE_PENDING', 8) })])).toBe('IN_PROGRESS');
    expect(deriveStockRequestStatus('IN_PROGRESS', [line({ fulfilStatus: 'ALLOCATED', transferLines: shipped('COMPLETED', 8) })])).toBe('COMPLETED');
  });
  it('rút hết mọi dòng khi chưa cấp: WITHDRAWN', () => {
    expect(deriveStockRequestStatus('ACCEPTED', [line({ fulfilStatus: 'WITHDRAWN' }), line({ fulfilStatus: 'WITHDRAWN' })])).toBe('WITHDRAWN');
  });
  it('phiếu điều chuyển nháp bị từ chối: dòng về chưa cấp thì không còn tính là đã quyết định', () => {
    // sync đặt dòng về PENDING trước khi tính; ở đây kiểm đúng kết quả với dòng PENDING không còn phiếu hiệu lực
    expect(deriveStockRequestStatus('IN_PROGRESS', [line({ fulfilStatus: 'PENDING', transferLines: [{ transferStatus: 'REJECTED', quantityShipped: 10, quantityReceived: null }] })])).toBe('ACCEPTED');
  });
});

describe('hasAllocation', () => {
  it('chỉ tính phiếu điều chuyển còn hiệu lực', () => {
    expect(hasAllocation([line({ transferLines: [{ transferStatus: 'REJECTED', quantityShipped: 5, quantityReceived: null }] })])).toBe(false);
    expect(hasAllocation([line({ transferLines: [{ transferStatus: 'DRAFT', quantityShipped: 5, quantityReceived: null }] })])).toBe(true);
  });
});

describe('requesterActions (ma trận màn 6b)', () => {
  it('đã gửi: huỷ, sửa tự do, thêm/rút được', () => {
    expect(requesterActions('SUBMITTED')).toMatchObject({ cancel: true, edit: true, addLines: true, withdrawLines: true, message: true });
  });
  it('đã tiếp nhận mà chưa cấp: không huỷ/sửa tự do, nhưng thêm và rút được', () => {
    expect(requesterActions('ACCEPTED')).toMatchObject({ cancel: false, edit: false, addLines: true, withdrawLines: true, withdrawOnlyWaiting: false });
  });
  it('đang xử lý: không thêm, chỉ rút dòng chờ hàng về', () => {
    expect(requesterActions('IN_PROGRESS')).toMatchObject({ cancel: false, addLines: false, withdrawLines: true, withdrawOnlyWaiting: true });
  });
  it('trạng thái cuối không làm được gì', () => {
    for (const s of ['COMPLETED', 'REJECTED', 'CANCELLED', 'WITHDRAWN'] as const) {
      expect(Object.values(requesterActions(s)).every((v) => v === false)).toBe(true);
    }
  });
});

describe('supplierActions', () => {
  it('đã gửi: tiếp nhận hoặc từ chối cả phiếu', () => {
    expect(supplierActions('SUBMITTED')).toEqual({ accept: true, rejectAll: true, allocate: false });
  });
  it('đang xử lý: chỉ cấp tiếp, không còn từ chối cả phiếu', () => {
    expect(supplierActions('IN_PROGRESS')).toEqual({ accept: false, rejectAll: false, allocate: true });
  });
});

describe('resolveSupplyingWarehouseId', () => {
  const main = { id: 'w-main-q3', branchId: 'b-q3' };
  it('kho phụ xin kho chính cùng chi nhánh', () => {
    expect(resolveSupplyingWarehouseId({ id: 'w-sub', branchId: 'b-td' }, { id: 'w-main-td' }, main)).toBe('w-main-td');
  });
  it('kho chính chi nhánh phụ xin kho chính chi nhánh chính', () => {
    expect(resolveSupplyingWarehouseId({ id: 'w-main-td', branchId: 'b-td' }, { id: 'w-main-td' }, main)).toBe('w-main-q3');
  });
  it('kho chính của chi nhánh chính không có cấp trên', () => {
    expect(resolveSupplyingWarehouseId({ id: 'w-main-q3', branchId: 'b-q3' }, { id: 'w-main-q3' }, main)).toBeNull();
  });
  it('công ty một chi nhánh một kho: không có cấp trên', () => {
    expect(resolveSupplyingWarehouseId({ id: 'w1', branchId: 'b1' }, { id: 'w1' }, { id: 'w1', branchId: 'b1' })).toBeNull();
  });
  it('chi nhánh chưa có kho mặc định: không tự bịa cấp trên cùng chi nhánh', () => {
    expect(resolveSupplyingWarehouseId({ id: 'w-x', branchId: 'b-td' }, null, main)).toBe('w-main-q3');
  });
});
