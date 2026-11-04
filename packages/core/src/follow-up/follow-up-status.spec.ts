import { describe, expect, it } from 'vitest';
import { classifyFollowUp, followUpInTab } from './follow-up-status';

const TODAY = '2026-11-04';
const OVERDUE_FROM = '2026-10-05';
const UPCOMING_TO = '2026-11-11';

describe('classifyFollowUp', () => {
  it('đã quay lại luôn là ARRIVED, bất kể ngày hẹn', () => {
    expect(classifyFollowUp('2026-10-01', TODAY, true)).toBe('ARRIVED');
    expect(classifyFollowUp(TODAY, TODAY, true)).toBe('ARRIVED');
    expect(classifyFollowUp('2026-12-01', TODAY, true)).toBe('ARRIVED');
  });
  it('chưa quay lại: hôm nay / đã qua / chưa tới', () => {
    expect(classifyFollowUp(TODAY, TODAY, false)).toBe('DUE_TODAY');
    expect(classifyFollowUp('2026-11-03', TODAY, false)).toBe('OVERDUE');
    expect(classifyFollowUp('2026-11-05', TODAY, false)).toBe('UPCOMING');
  });
});

describe('followUpInTab', () => {
  const inTab = (tab: Parameters<typeof followUpInTab>[0], d: string, returned = false) => followUpInTab(tab, d, TODAY, returned, OVERDUE_FROM, UPCOMING_TO);

  it('today: ngày hẹn là hôm nay, kể cả đã đến', () => {
    expect(inTab('today', TODAY)).toBe(true);
    expect(inTab('today', TODAY, true)).toBe(true);
    expect(inTab('today', '2026-11-03')).toBe(false);
  });
  it('overdue: trong 30 ngày qua, chưa quay lại; biên 05/10 còn, 04/10 mất', () => {
    expect(inTab('overdue', '2026-11-03')).toBe(true);
    expect(inTab('overdue', OVERDUE_FROM)).toBe(true);
    expect(inTab('overdue', '2026-10-04')).toBe(false);
    expect(inTab('overdue', '2026-11-03', true)).toBe(false);
    expect(inTab('overdue', TODAY)).toBe(false);
  });
  it('upcoming: từ ngày mai đến 7 ngày tới, chưa quay lại; biên 11/11 còn, 12/11 mất', () => {
    expect(inTab('upcoming', '2026-11-05')).toBe(true);
    expect(inTab('upcoming', UPCOMING_TO)).toBe(true);
    expect(inTab('upcoming', '2026-11-12')).toBe(false);
    expect(inTab('upcoming', '2026-11-05', true)).toBe(false);
    expect(inTab('upcoming', TODAY)).toBe(false);
  });
  it('all: mọi hẹn', () => {
    expect(inTab('all', '2020-01-01', true)).toBe(true);
    expect(inTab('all', '2030-01-01')).toBe(true);
  });
});
