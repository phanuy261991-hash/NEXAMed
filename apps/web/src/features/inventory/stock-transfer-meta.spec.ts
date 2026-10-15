import { describe, expect, it } from 'vitest';
import { nextTransferAction, TRANSFER_STATUS_META, TRANSFER_STATUS_ORDER, transferSides, varianceOverdueDays, VARIANCE_OVERDUE_DAYS } from './stock-transfer-meta';

const A = 'branch-a';
const B = 'branch-b';

describe('stock-transfer-meta', () => {
  it('mọi trạng thái đều có nhãn và nằm trong thứ tự lọc', () => {
    expect(TRANSFER_STATUS_ORDER).toHaveLength(Object.keys(TRANSFER_STATUS_META).length);
    for (const status of TRANSFER_STATUS_ORDER) expect(TRANSFER_STATUS_META[status].label).not.toBe('');
  });

  it('transferSides: điều chuyển cùng chi nhánh vừa gửi vừa nhận; khác chi nhánh chỉ một bên', () => {
    expect(transferSides({ fromBranchId: A, toBranchId: A }, A)).toEqual({ isSender: true, isReceiver: true });
    expect(transferSides({ fromBranchId: A, toBranchId: B }, A)).toEqual({ isSender: true, isReceiver: false });
    expect(transferSides({ fromBranchId: A, toBranchId: B }, B)).toEqual({ isSender: false, isReceiver: true });
    expect(transferSides({ fromBranchId: A, toBranchId: B }, null)).toEqual({ isSender: false, isReceiver: false });
  });

  it('nextTransferAction: bên nhận kiểm nhận phiếu đang vận chuyển; bên gửi xử lý chênh lệch và nhận lại hàng', () => {
    expect(nextTransferAction({ status: 'IN_TRANSIT', fromBranchId: A, toBranchId: B }, B)).toBe('receive');
    expect(nextTransferAction({ status: 'IN_TRANSIT', fromBranchId: A, toBranchId: B }, A)).toBeNull();
    expect(nextTransferAction({ status: 'VARIANCE_PENDING', fromBranchId: A, toBranchId: B }, A)).toBe('resolve');
    expect(nextTransferAction({ status: 'VARIANCE_PENDING', fromBranchId: A, toBranchId: B }, B)).toBeNull();
    expect(nextTransferAction({ status: 'RETURNING', fromBranchId: A, toBranchId: B }, A)).toBe('confirm-return');
    expect(nextTransferAction({ status: 'RETURNING', fromBranchId: A, toBranchId: B }, B)).toBeNull();
  });

  it('nextTransferAction: trạng thái kết thúc và Nháp không còn việc nào', () => {
    for (const status of ['DRAFT', 'COMPLETED', 'REJECTED', 'RETURNED'] as const) {
      expect(nextTransferAction({ status, fromBranchId: A, toBranchId: A }, A)).toBeNull();
    }
  });

  it('nextTransferAction: cùng chi nhánh — IN_TRANSIT vẫn do chính chi nhánh đó kiểm nhận', () => {
    expect(nextTransferAction({ status: 'IN_TRANSIT', fromBranchId: A, toBranchId: A }, A)).toBe('receive');
  });
});

describe('varianceOverdueDays (nhãn "Quá hạn xử lý" của phiếu chờ xử lý chênh lệch)', () => {
  const DAY = 86_400_000;
  const now = Date.parse('2026-10-20T00:00:00.000Z');
  const received = (daysAgo: number) => new Date(now - daysAgo * DAY).toISOString();

  it('quá hạn khi chờ lâu hơn ngưỡng; đúng ngưỡng hoặc ít hơn thì chưa', () => {
    expect(varianceOverdueDays({ status: 'VARIANCE_PENDING', receivedAt: received(VARIANCE_OVERDUE_DAYS + 3) }, now)).toBe(VARIANCE_OVERDUE_DAYS + 3);
    expect(varianceOverdueDays({ status: 'VARIANCE_PENDING', receivedAt: received(VARIANCE_OVERDUE_DAYS) }, now)).toBeNull();
    expect(varianceOverdueDays({ status: 'VARIANCE_PENDING', receivedAt: received(1) }, now)).toBeNull();
  });

  it('chỉ áp cho phiếu đang chờ xử lý chênh lệch và có ngày kiểm nhận', () => {
    expect(varianceOverdueDays({ status: 'COMPLETED', receivedAt: received(30) }, now)).toBeNull();
    expect(varianceOverdueDays({ status: 'RETURNING', receivedAt: received(30) }, now)).toBeNull();
    expect(varianceOverdueDays({ status: 'VARIANCE_PENDING', receivedAt: null }, now)).toBeNull();
  });
});
