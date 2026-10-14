import { describe, expect, it } from 'vitest';
import { lookupStatusBadge, lookupSummaryBadge, orderGroupCountLabel, orderProgressBadge, ORDER_PAYMENT_BADGE } from './clinical-order-book-labels';

describe('nhãn Phiếu chỉ định / Tra cứu kết quả', () => {
  it('tiến độ: màu theo tín hiệu y tế, kèm phân số đã xong/tổng', () => {
    expect(orderProgressBadge({ state: 'WAITING', done: 0, total: 2 })).toEqual({ tone: 'warning', label: 'Chờ thực hiện 0/2' });
    expect(orderProgressBadge({ state: 'IN_PROGRESS', done: 1, total: 3 })).toEqual({ tone: 'info', label: 'Đang thực hiện 1/3' });
    expect(orderProgressBadge({ state: 'DONE', done: 2, total: 2 })).toEqual({ tone: 'success', label: 'Đã có kết quả 2/2' });
    expect(orderProgressBadge({ state: 'CANCELLED', done: 0, total: 0 })).toEqual({ tone: 'neutral', label: 'Đã huỷ' });
    expect(orderProgressBadge({ state: 'EXTERNAL', done: 0, total: 1 }).label).toBe('Chỉ định ra ngoài');
  });

  it('thanh toán: đủ 4 trạng thái có nhãn tiếng Việt', () => {
    expect(Object.values(ORDER_PAYMENT_BADGE).map((b) => b.label)).toEqual(['Đã thu', 'Chưa thu', 'Đã hoàn', 'Không thu']);
  });

  it('dòng phụ đếm dịch vụ theo nhóm', () => {
    expect(orderGroupCountLabel('LAB', 4)).toBe('4 dịch vụ xét nghiệm');
    expect(orderGroupCountLabel('IMAGING', 1)).toBe('1 dịch vụ CĐHA & thăm dò');
    expect(orderGroupCountLabel('EXTERNAL', 2)).toBe('2 dịch vụ ra ngoài');
  });

  it('tra cứu kết quả: trạng thái và tóm tắt', () => {
    expect(lookupStatusBadge('AMENDED').label).toBe('Đã đính chính');
    expect(lookupStatusBadge('APPROVED').label).toBe('Đã duyệt');
    expect(lookupSummaryBadge('ABNORMAL', 3)).toEqual({ tone: 'warning', label: '3 chỉ số bất thường' });
    expect(lookupSummaryBadge('NORMAL', 0)?.label).toBe('Bình thường');
    expect(lookupSummaryBadge('HAS_CONCLUSION', 0)?.label).toBe('Có kết luận');
    expect(lookupSummaryBadge('NONE', 0)).toBeNull();
  });
});
