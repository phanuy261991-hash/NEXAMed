import { describe, expect, it } from 'vitest';
import { checkParaclinicalSectionComplete, deriveQueueBucket, groupQueueItems, type QueueGroupableItem } from './paraclinical-result';

describe('deriveQueueBucket', () => {
  it('ORDERED chưa thu → Chờ thu tiền; đã thu → Chờ lấy mẫu', () => {
    expect(deriveQueueBucket('ORDERED', false, false)).toBe('AWAITING_PAYMENT');
    expect(deriveQueueBucket('ORDERED', true, false)).toBe('WAITING');
  });

  it('bật "thực hiện trước khi thu tiền" → chưa thu vẫn vào Chờ lấy mẫu', () => {
    expect(deriveQueueBucket('ORDERED', false, true)).toBe('WAITING');
  });

  it('các trạng thái sau không phụ thuộc thu tiền; đã huỷ không có tab', () => {
    expect(deriveQueueBucket('IN_PROGRESS', false, false)).toBe('IN_PROGRESS');
    expect(deriveQueueBucket('RESULTED', true, false)).toBe('PENDING_APPROVAL');
    expect(deriveQueueBucket('COMPLETED', true, false)).toBe('COMPLETED');
    expect(deriveQueueBucket('CANCELLED', true, false)).toBeNull();
  });
});

describe('groupQueueItems', () => {
  const item = (id: string, over: Partial<QueueGroupableItem> = {}): QueueGroupableItem => ({
    id,
    clinicalOrderId: 'o1',
    serviceKind: 'LAB',
    status: 'ORDERED',
    paid: true,
    ...over,
  });

  it('xét nghiệm cùng phiếu + cùng trạng thái + cùng thu tiền gộp 1 nhóm', () => {
    const groups = groupQueueItems([item('a'), item('b'), item('c')]);
    expect(groups.map((g) => g.map((i) => i.id))).toEqual([['a', 'b', 'c']]);
  });

  it('khác phiếu / khác trạng thái / khác tình trạng thu thì tách nhóm', () => {
    const groups = groupQueueItems([item('a'), item('b', { clinicalOrderId: 'o2' }), item('c', { status: 'IN_PROGRESS' }), item('d', { paid: false })]);
    expect(groups).toHaveLength(4);
  });

  it('chẩn đoán hình ảnh / thăm dò chức năng luôn 1 nhóm riêng dù cùng phiếu', () => {
    const groups = groupQueueItems([item('a', { serviceKind: 'IMAGING' }), item('b', { serviceKind: 'IMAGING' }), item('c', { serviceKind: 'FUNCTIONAL' }), item('d')]);
    expect(groups.map((g) => g.map((i) => i.id))).toEqual([['a'], ['b'], ['c'], ['d']]);
  });
});

describe('checkParaclinicalSectionComplete', () => {
  const indicator = (over: Partial<{ valueText: string | null; valueType: 'NUMBER' | 'TEXT' | 'CHOICE'; choiceOptions: string[] }> = {}) => ({
    name: 'Hồng cầu',
    valueType: 'NUMBER' as const,
    choiceOptions: [] as string[],
    valueText: '3,82' as string | null,
    ...over,
  });

  it('xét nghiệm đủ ít nhất 1 chỉ số hợp lệ → đạt', () => {
    expect(checkParaclinicalSectionComplete({ serviceName: 'CTM', resultType: 'INDICATORS', indicators: [indicator(), indicator({ valueText: '' })], descriptionText: null, conclusionText: null })).toEqual([]);
  });

  it('không nhập chỉ số nào → lỗi; giá trị không phải số → lỗi; lựa chọn ngoài danh sách → lỗi', () => {
    expect(checkParaclinicalSectionComplete({ serviceName: 'CTM', resultType: 'INDICATORS', indicators: [indicator({ valueText: null })], descriptionText: null, conclusionText: null })).toHaveLength(1);
    expect(checkParaclinicalSectionComplete({ serviceName: 'CTM', resultType: 'INDICATORS', indicators: [indicator({ valueText: 'abc' })], descriptionText: null, conclusionText: null })).toHaveLength(1);
    expect(
      checkParaclinicalSectionComplete({ serviceName: 'NT', resultType: 'INDICATORS', indicators: [indicator({ valueType: 'CHOICE', choiceOptions: ['Âm tính', 'Dương tính'], valueText: 'Có' })], descriptionText: null, conclusionText: null }),
    ).toHaveLength(1);
  });

  it('NARRATIVE cần cả mô tả lẫn kết luận; BOTH cần cả chỉ số lẫn mô tả/kết luận', () => {
    expect(checkParaclinicalSectionComplete({ serviceName: 'SA', resultType: 'NARRATIVE', indicators: [], descriptionText: 'Gan bình thường', conclusionText: ' ' })).toHaveLength(1);
    expect(checkParaclinicalSectionComplete({ serviceName: 'SA', resultType: 'NARRATIVE', indicators: [], descriptionText: 'a', conclusionText: 'b' })).toEqual([]);
    expect(checkParaclinicalSectionComplete({ serviceName: 'ECG', resultType: 'BOTH', indicators: [indicator()], descriptionText: null, conclusionText: 'b' })).toHaveLength(1);
  });
});
