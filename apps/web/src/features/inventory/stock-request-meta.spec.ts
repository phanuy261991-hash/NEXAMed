import { describe, expect, it } from 'vitest';
import { progressSummary, requesterActionsFor, stepState, supplierActionsFor } from './stock-request-meta';

describe('stock-request-meta', () => {
  it('bước đầu phiếu: đã gửi → tiếp nhận → xử lý → hoàn thành', () => {
    expect(stepState('SUBMITTED', 'SUBMITTED')).toBe('current');
    expect(stepState('SUBMITTED', 'ACCEPTED')).toBe('todo');
    expect(stepState('IN_PROGRESS', 'ACCEPTED')).toBe('done');
    expect(stepState('IN_PROGRESS', 'IN_PROGRESS')).toBe('current');
    expect(stepState('COMPLETED', 'COMPLETED')).toBe('done');
  });

  it('phiếu từ chối/huỷ/rút chỉ giữ bước "Đã gửi" là đã qua', () => {
    for (const s of ['REJECTED', 'CANCELLED', 'WITHDRAWN'] as const) {
      expect(stepState(s, 'SUBMITTED')).toBe('done');
      expect(stepState(s, 'IN_PROGRESS')).toBe('todo');
    }
  });

  it('ma trận bên xin theo trạng thái khớp mockup màn 6b', () => {
    expect(requesterActionsFor('SUBMITTED')).toMatchObject({ cancel: true, edit: true });
    expect(requesterActionsFor('ACCEPTED')).toMatchObject({ cancel: false, addLines: true, withdrawLines: true });
    expect(requesterActionsFor('IN_PROGRESS')).toMatchObject({ addLines: false, withdrawOnlyWaiting: true });
    expect(requesterActionsFor('COMPLETED').message).toBe(false);
  });

  it('kho cấp: chỉ cấp được sau khi tiếp nhận; từ chối cả phiếu chỉ khi chưa cấp', () => {
    expect(supplierActionsFor('SUBMITTED')).toEqual({ accept: true, rejectAll: true, allocate: false });
    expect(supplierActionsFor('ACCEPTED').allocate).toBe(true);
    expect(supplierActionsFor('IN_PROGRESS').rejectAll).toBe(false);
  });

  it('tóm tắt tiến độ đếm dòng xong và dòng chờ hàng về', () => {
    const lines = [{ displayStatus: 'RECEIVED' }, { displayStatus: 'WAITING_STOCK' }, { displayStatus: 'REJECTED' }] as never;
    expect(progressSummary({ lines })).toBe('2/3 dòng đã xong, 1 chờ hàng về');
  });
});
