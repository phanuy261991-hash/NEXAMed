import { describe, expect, it } from 'vitest';
import {
  canRecollectSpecimenTube,
  canSplitSpecimenTube,
  canUncollectSpecimenTube,
  joinGroupAbbreviations,
  normalizeScannedSid,
  planSpecimenTubes,
} from './plan-specimen-tubes';

describe('planSpecimenTubes', () => {
  it('gộp xét nghiệm cùng loại mẫu vào 1 ống, khác loại thì ống riêng — giữ thứ tự xuất hiện', () => {
    const plan = planSpecimenTubes(
      [
        { itemId: 'a', specimenTypeCode: 'MAU_EDTA' },
        { itemId: 'b', specimenTypeCode: 'HUYET_THANH' },
        { itemId: 'c', specimenTypeCode: 'MAU_EDTA' },
        { itemId: 'd', specimenTypeCode: 'HUYET_THANH' },
        { itemId: 'e', specimenTypeCode: 'NUOC_TIEU' },
      ],
      [],
    );
    expect(plan.attach).toEqual([]);
    expect(plan.create).toEqual([
      { specimenTypeCode: 'MAU_EDTA', itemIds: ['a', 'c'] },
      { specimenTypeCode: 'HUYET_THANH', itemIds: ['b', 'd'] },
      { specimenTypeCode: 'NUOC_TIEU', itemIds: ['e'] },
    ]);
  });

  it('dòng chưa khai loại mẫu gộp chung 1 ống "không rõ mẫu"', () => {
    const plan = planSpecimenTubes(
      [
        { itemId: 'a', specimenTypeCode: null },
        { itemId: 'b', specimenTypeCode: null },
      ],
      [],
    );
    expect(plan.create).toEqual([{ specimenTypeCode: null, itemIds: ['a', 'b'] }]);
  });

  it('gộp vào ống PENDING chưa in tem cùng loại mẫu; ống đã in tem thì KHÔNG gộp thêm', () => {
    const plan = planSpecimenTubes(
      [
        { itemId: 'a', specimenTypeCode: 'HUYET_THANH' },
        { itemId: 'b', specimenTypeCode: 'MAU_EDTA' },
      ],
      [
        { id: 't1', specimenTypeCode: 'HUYET_THANH', printCount: 0 },
        { id: 't2', specimenTypeCode: 'MAU_EDTA', printCount: 1 },
      ],
    );
    expect(plan.attach).toEqual([{ itemId: 'a', tubeId: 't1' }]);
    expect(plan.create).toEqual([{ specimenTypeCode: 'MAU_EDTA', itemIds: ['b'] }]);
  });

  it('không có dòng nào cần xếp thì không làm gì', () => {
    expect(planSpecimenTubes([], [{ id: 't1', specimenTypeCode: null, printCount: 0 }])).toEqual({ attach: [], create: [] });
  });
});

describe('joinGroupAbbreviations', () => {
  it('nối không trùng bằng "/" và bỏ nhóm chưa khai viết tắt', () => {
    expect(joinGroupAbbreviations(['HH', null, 'SH', 'HH', '  ', undefined])).toBe('HH/SH');
  });
  it('không có viết tắt nào thì null', () => {
    expect(joinGroupAbbreviations([null, undefined, ' '])).toBeNull();
  });
});

describe('điều kiện thao tác trên ống', () => {
  it('chỉ tách khi PENDING, chưa in và còn > 1 xét nghiệm', () => {
    expect(canSplitSpecimenTube({ status: 'PENDING', printCount: 0 }, 2)).toBe(true);
    expect(canSplitSpecimenTube({ status: 'PENDING', printCount: 0 }, 1)).toBe(false);
    expect(canSplitSpecimenTube({ status: 'PENDING', printCount: 1 }, 3)).toBe(false);
    expect(canSplitSpecimenTube({ status: 'COLLECTED', printCount: 0 }, 3)).toBe(false);
  });
  it('huỷ ống & lấy lại khi chưa huỷ và chưa có kết quả; huỷ xác nhận chỉ khi đã lấy và chưa có kết quả', () => {
    expect(canRecollectSpecimenTube({ status: 'PENDING' }, false)).toBe(true);
    expect(canRecollectSpecimenTube({ status: 'COLLECTED' }, false)).toBe(true);
    expect(canRecollectSpecimenTube({ status: 'COLLECTED' }, true)).toBe(false);
    expect(canRecollectSpecimenTube({ status: 'CANCELLED' }, false)).toBe(false);
    expect(canUncollectSpecimenTube({ status: 'COLLECTED' }, false)).toBe(true);
    expect(canUncollectSpecimenTube({ status: 'COLLECTED' }, true)).toBe(false);
    expect(canUncollectSpecimenTube({ status: 'PENDING' }, false)).toBe(false);
  });
});

describe('normalizeScannedSid', () => {
  it('bỏ khoảng trắng và ký tự điều khiển súng quét gửi kèm, giữ nguyên chữ hoa/thường', () => {
    expect(normalizeScannedSid('  2610080014\r\n')).toBe('2610080014');
    expect(normalizeScannedSid('\t26100A0014 ')).toBe('26100A0014');
  });
});
