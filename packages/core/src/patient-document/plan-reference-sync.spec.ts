import { describe, expect, it } from 'vitest';
import { planReferenceSync } from './plan-reference-sync';

const entry = (storageKey: string, over: Partial<{ sourceType: string; sourceId: string; encounterId: string | null; branchId: string }> = {}) => ({
  storageKey,
  sourceType: 'PARACLINICAL_IMAGE',
  sourceId: `src-${storageKey}`,
  encounterId: 'enc-1' as string | null,
  branchId: 'br-1',
  ...over,
});
const row = (id: string, storageKey: string, over: Partial<{ sourceType: string; sourceId: string; encounterId: string | null; branchId: string }> = {}) => ({ id, ...entry(storageKey, over) });

describe('planReferenceSync', () => {
  it('nguồn có mà chưa có dòng → tạo mới', () => {
    const plan = planReferenceSync([entry('a'), entry('b')], [row('r1', 'a')]);
    expect(plan.toCreate.map((e) => e.storageKey)).toEqual(['b']);
    expect(plan.toUpdate).toEqual([]);
    expect(plan.toRemoveIds).toEqual([]);
  });

  it('dòng còn mà nguồn đã mất → gỡ', () => {
    const plan = planReferenceSync([entry('a')], [row('r1', 'a'), row('r2', 'gone')]);
    expect(plan.toRemoveIds).toEqual(['r2']);
    expect(plan.toCreate).toEqual([]);
  });

  it('không có gì thay đổi → kế hoạch rỗng (lần mở tab thứ hai không ghi gì)', () => {
    const plan = planReferenceSync([entry('a'), entry('b')], [row('r1', 'a'), row('r2', 'b')]);
    expect(plan).toEqual({ toCreate: [], toUpdate: [], toRemoveIds: [] });
  });

  it('nhiều nguồn trỏ cùng một tệp → chỉ một dòng, nguồn đứng trước thắng', () => {
    const plan = planReferenceSync([entry('pdf', { sourceId: 'first' }), entry('pdf', { sourceId: 'second' })], []);
    expect(plan.toCreate).toHaveLength(1);
    expect(plan.toCreate[0]!.sourceId).toBe('first');
  });

  it('thông tin nguồn đổi mà tệp giữ nguyên → cập nhật tại chỗ, không tạo dòng thứ hai', () => {
    const plan = planReferenceSync([entry('pdf', { sourceId: 'new', encounterId: 'enc-2' })], [row('r1', 'pdf', { sourceId: 'old' })]);
    expect(plan.toCreate).toEqual([]);
    expect(plan.toRemoveIds).toEqual([]);
    expect(plan.toUpdate).toEqual([{ id: 'r1', data: { sourceType: 'PARACLINICAL_IMAGE', sourceId: 'new', encounterId: 'enc-2', branchId: 'br-1' } }]);
  });

  it('dòng cũ bị trùng khoá (dữ liệu lỗi) → giữ một, gỡ phần thừa', () => {
    const plan = planReferenceSync([entry('a')], [row('r1', 'a'), row('r2', 'a')]);
    expect(plan.toRemoveIds).toEqual(['r2']);
    expect(plan.toCreate).toEqual([]);
  });

  it('nguồn rỗng (công tắc BHYT tắt, kết quả đang đính chính) → gỡ hết', () => {
    const plan = planReferenceSync([], [row('r1', 'a'), row('r2', 'b')]);
    expect(plan.toRemoveIds).toEqual(['r1', 'r2']);
  });
});
