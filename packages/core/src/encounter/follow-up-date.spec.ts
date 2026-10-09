import { describe, expect, it } from 'vitest';
import {
  FOLLOW_UP_MAX_DAYS,
  addDaysToDateString,
  diffDateStrings,
  formatDateStringVi,
  resolveFollowUpFromDate,
  resolveFollowUpFromDays,
  vietnameseWeekdayLabel,
} from './follow-up-date';

describe('addDaysToDateString / diffDateStrings', () => {
  it('cộng ngày qua ranh giới tháng, năm và năm nhuận', () => {
    expect(addDaysToDateString('2026-10-08', 7)).toBe('2026-10-15');
    expect(addDaysToDateString('2026-10-30', 3)).toBe('2026-11-02');
    expect(addDaysToDateString('2026-12-30', 5)).toBe('2027-01-04');
    expect(addDaysToDateString('2028-02-27', 2)).toBe('2028-02-29');
    expect(addDaysToDateString('2027-02-27', 2)).toBe('2027-03-01');
  });
  it('chuỗi ngày sai định dạng hoặc không tồn tại → null', () => {
    expect(addDaysToDateString('2026-02-31', 1)).toBeNull();
    expect(addDaysToDateString('08/10/2026', 1)).toBeNull();
    expect(addDaysToDateString('2026-10-08', 1.5)).toBeNull();
    expect(diffDateStrings('2026-10-08', 'abc')).toBeNull();
  });
  it('diff là nghịch đảo của add', () => {
    for (const n of [1, 7, 30, 365]) {
      const to = addDaysToDateString('2026-10-08', n)!;
      expect(diffDateStrings('2026-10-08', to)).toBe(n);
    }
    expect(diffDateStrings('2026-10-08', '2026-10-01')).toBe(-7);
  });
});

describe('resolveFollowUpFromDays', () => {
  it('quy đổi số ngày ra ngày hẹn tính từ ngày khám', () => {
    expect(resolveFollowUpFromDays('2026-10-08', 3)).toEqual({ ok: true, date: '2026-10-11', days: 3 });
    expect(resolveFollowUpFromDays('2026-10-08', FOLLOW_UP_MAX_DAYS)).toMatchObject({ ok: true, days: 365 });
  });
  it('từ chối 0, số âm, số thập phân và quá 365', () => {
    for (const bad of [0, -1, 2.5, 366, Number.NaN]) {
      expect(resolveFollowUpFromDays('2026-10-08', bad)).toMatchObject({ ok: false });
    }
  });
});

describe('resolveFollowUpFromDate', () => {
  it('ngày hẹn hợp lệ → số ngày kể từ ngày khám', () => {
    expect(resolveFollowUpFromDate('2026-10-08', '2026-10-15')).toEqual({ ok: true, date: '2026-10-15', days: 7 });
  });
  it('phải sau ngày khám: cùng ngày hoặc trước đều bị từ chối', () => {
    expect(resolveFollowUpFromDate('2026-10-08', '2026-10-08')).toMatchObject({ ok: false });
    expect(resolveFollowUpFromDate('2026-10-08', '2026-10-01')).toMatchObject({ ok: false });
  });
  it('không quá 365 ngày; ngày không tồn tại bị từ chối', () => {
    expect(resolveFollowUpFromDate('2026-10-08', '2027-10-08')).toMatchObject({ ok: true, days: 365 });
    expect(resolveFollowUpFromDate('2026-10-08', '2027-10-09')).toMatchObject({ ok: false });
    expect(resolveFollowUpFromDate('2026-10-08', '2026-11-31')).toMatchObject({ ok: false });
  });
});

describe('nhãn hiển thị', () => {
  it('thứ trong tuần và định dạng dd/mm/yyyy', () => {
    expect(vietnameseWeekdayLabel('2026-10-15')).toBe('Thứ Năm');
    expect(vietnameseWeekdayLabel('2026-10-11')).toBe('Chủ nhật');
    expect(vietnameseWeekdayLabel('xx')).toBe('');
    expect(formatDateStringVi('2026-10-15')).toBe('15/10/2026');
  });
});
