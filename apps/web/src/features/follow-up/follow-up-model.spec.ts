import { describe, expect, it } from 'vitest';
import { FOLLOW_UP_REMINDER_RESULT_LABEL, FOLLOW_UP_STATUS_LABEL, bookingHref, canRemind, dueLabel, formatDmy, formatPhone, parseFollowUpTab } from './follow-up-model';

const TODAY = '2026-11-04';

describe('formatDmy / dueLabel', () => {
  it('định dạng ngày và nhãn tương đối', () => {
    expect(formatDmy('2026-11-04')).toBe('04-11-2026');
    expect(dueLabel(TODAY, TODAY)).toBe('Hôm nay');
    expect(dueLabel('2026-11-05', TODAY)).toBe('Ngày mai');
    expect(dueLabel('2026-11-09', TODAY)).toBe('Còn 5 ngày');
    expect(dueLabel('2026-11-01', TODAY)).toBe('Trễ 3 ngày');
    expect(dueLabel('2026-11-03', TODAY)).toBe('Trễ 1 ngày');
  });
});

describe('formatPhone', () => {
  it('nhóm 4-3-3 cho số 10 chữ số, giữ nguyên số khác', () => {
    expect(formatPhone('0912345678')).toBe('0912 345 678');
    expect(formatPhone('0912 345 678')).toBe('0912 345 678');
    expect(formatPhone('+84912345678')).toBe('+84912345678');
  });
});

describe('canRemind', () => {
  it('chỉ hẹn chưa quay lại mới nhắc/đặt lịch được', () => {
    expect(canRemind({ status: 'DUE_TODAY' })).toBe(true);
    expect(canRemind({ status: 'OVERDUE' })).toBe(true);
    expect(canRemind({ status: 'UPCOMING' })).toBe(true);
    expect(canRemind({ status: 'ARRIVED' })).toBe(false);
  });
});

describe('bookingHref', () => {
  const item = { patientName: 'Nguyễn Thị Lan', phone: '0912345678', doctorId: '11111111-1111-1111-1111-111111111111', followUpDate: '2026-11-10' };
  it('điền sẵn tên, SĐT, bác sĩ, lý do; mở ở ngày hẹn nếu chưa tới', () => {
    const url = new URL('http://x' + bookingHref(item, TODAY));
    expect(url.pathname).toBe('/appointments');
    expect(url.searchParams.get('date')).toBe('2026-11-10');
    expect(url.searchParams.get('book')).toBe('1');
    expect(url.searchParams.get('name')).toBe('Nguyễn Thị Lan');
    expect(url.searchParams.get('phone')).toBe('0912345678');
    expect(url.searchParams.get('doctorId')).toBe(item.doctorId);
    expect(url.searchParams.get('reason')).toBe('Tái khám');
  });
  it('hẹn đã qua thì mở ở hôm nay; không có bác sĩ thì bỏ tham số bác sĩ', () => {
    const url = new URL('http://x' + bookingHref({ ...item, followUpDate: '2026-10-20', doctorId: null }, TODAY));
    expect(url.searchParams.get('date')).toBe(TODAY);
    expect(url.searchParams.has('doctorId')).toBe(false);
  });
});

describe('parseFollowUpTab', () => {
  it('nhận 4 tab hợp lệ; giá trị lạ hoặc thiếu về "Hôm nay"', () => {
    for (const tab of ['today', 'overdue', 'upcoming', 'all'] as const) expect(parseFollowUpTab(tab)).toBe(tab);
    expect(parseFollowUpTab(null)).toBe('today');
    expect(parseFollowUpTab('')).toBe('today');
    expect(parseFollowUpTab('khac')).toBe('today');
  });
});

describe('nhãn tiếng Việt', () => {
  it('đủ nhãn cho mọi trạng thái và kết quả nhắc, không rỗng', () => {
    expect(Object.keys(FOLLOW_UP_STATUS_LABEL).sort()).toEqual(['ARRIVED', 'DUE_TODAY', 'OVERDUE', 'UPCOMING']);
    expect(Object.keys(FOLLOW_UP_REMINDER_RESULT_LABEL).sort()).toEqual(['CALL_BACK_LATER', 'NOT_RETURNING', 'NO_ANSWER', 'REACHED']);
    for (const label of [...Object.values(FOLLOW_UP_STATUS_LABEL), ...Object.values(FOLLOW_UP_REMINDER_RESULT_LABEL)]) expect(label.trim()).not.toBe('');
  });
});
