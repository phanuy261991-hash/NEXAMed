import { describe, expect, it } from 'vitest';
import { progressSummary, requesterActionsFor, stepState, summarizeRequesterUpdates, supplierActionsFor } from './stock-request-meta';

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

describe('summarizeRequesterUpdates', () => {
  const ev = (eventType: string, message: string, detail: string | null, occurredAt: string) => ({ eventType, message, detail, occurredAt });

  it('gom việc bên xin vừa thêm/rút sau lần tiếp nhận gần nhất, lấy mốc giờ của cập nhật cuối', () => {
    const result = summarizeRequesterUpdates([
      ev('submitted', 'Đã gửi', null, '2026-11-12T01:00:00Z'),
      ev('accepted', 'Đã tiếp nhận', null, '2026-11-12T02:00:00Z'),
      ev('lines_added', 'Thêm 1 mặt hàng', 'Kim lấy máu chân không', '2026-11-12T02:50:00Z'),
      ev('lines_withdrawn', 'Rút 1 dòng', 'Cồn 70 độ 500ml', '2026-11-12T02:55:00Z'),
    ]);
    expect(result).toEqual({ at: '2026-11-12T02:55:00Z', text: 'thêm 1 mặt hàng (Kim lấy máu chân không) và rút 1 dòng (Cồn 70 độ 500ml)' });
  });

  it('bỏ qua cập nhật TRƯỚC lần tiếp nhận và các sự kiện không phải cập nhật của bên xin', () => {
    expect(summarizeRequesterUpdates([ev('lines_added', 'Thêm 1 mặt hàng', 'A', '2026-11-12T01:00:00Z'), ev('accepted', 'Đã tiếp nhận', null, '2026-11-12T02:00:00Z'), ev('allocated', 'Cấp đợt 1', null, '2026-11-12T03:00:00Z')])).toBeNull();
  });

  it('không có sự kiện nào thì null; chỉ giữ hai cập nhật mới nhất', () => {
    expect(summarizeRequesterUpdates([])).toBeNull();
    const many = summarizeRequesterUpdates([ev('lines_added', 'Thêm 1 mặt hàng', 'A', '2026-11-12T01:00:00Z'), ev('lines_added', 'Thêm 1 mặt hàng', 'B', '2026-11-12T02:00:00Z'), ev('lines_added', 'Thêm 1 mặt hàng', 'C', '2026-11-12T03:00:00Z')]);
    expect(many?.text).toBe('thêm 1 mặt hàng (B) và thêm 1 mặt hàng (C)');
  });
});
