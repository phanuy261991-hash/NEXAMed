import { describe, expect, it } from 'vitest';
import {
  classifyLabPartnerStatementItem,
  isInLabPartnerStatementPeriod,
  labPartnerStatementDate,
  matchesLabPartnerStatementFilter,
  summarizeLabPartnerStatement,
} from './lab-partner-statement';

const at = (iso: string): Date => new Date(iso);
const NOW = at('2026-11-06T04:00:00.000Z');

describe('classifyLabPartnerStatementItem', () => {
  it('đã nhận đúng hạn: DONE, không trễ, có thời gian trả', () => {
    const r = classifyLabPartnerStatementItem({ status: 'RECEIVED', sentAt: at('2026-11-05T03:30:00Z'), receivedAt: at('2026-11-05T09:20:00Z'), dueAt: at('2026-11-06T03:30:00Z') }, NOW);
    expect(r).toEqual({ state: 'DONE', late: false, turnaroundMinutes: 350 });
  });

  it('đã nhận sau hạn: DONE và trễ', () => {
    const r = classifyLabPartnerStatementItem({ status: 'RECEIVED', sentAt: at('2026-11-02T02:00:00Z'), receivedAt: at('2026-11-04T02:00:00Z'), dueAt: at('2026-11-03T02:00:00Z') }, NOW);
    expect(r.state).toBe('DONE');
    expect(r.late).toBe(true);
  });

  it('nhận đúng giờ hạn thì chưa tính trễ', () => {
    const due = at('2026-11-03T02:00:00Z');
    expect(classifyLabPartnerStatementItem({ status: 'RECEIVED', sentAt: at('2026-11-02T02:00:00Z'), receivedAt: due, dueAt: due }, NOW).late).toBe(false);
  });

  it('dịch vụ chưa đặt hạn trả thì không bao giờ trễ', () => {
    expect(classifyLabPartnerStatementItem({ status: 'RECEIVED', sentAt: at('2026-11-01T00:00:00Z'), receivedAt: at('2026-11-05T00:00:00Z'), dueAt: null }, NOW).late).toBe(false);
    expect(classifyLabPartnerStatementItem({ status: 'SENT', sentAt: at('2026-10-01T00:00:00Z'), receivedAt: null, dueAt: null }, NOW).late).toBe(false);
  });

  it('đang chờ: WAITING, trễ khi quá hạn so với "bây giờ"', () => {
    const waiting = { status: 'SENT' as const, sentAt: at('2026-11-05T00:00:00Z'), receivedAt: null };
    expect(classifyLabPartnerStatementItem({ ...waiting, dueAt: at('2026-11-07T00:00:00Z') }, NOW)).toEqual({ state: 'WAITING', late: false, turnaroundMinutes: null });
    expect(classifyLabPartnerStatementItem({ ...waiting, dueAt: at('2026-11-06T00:00:00Z') }, NOW).late).toBe(true);
  });

  it('đối tác không nhận: REJECTED, không bao giờ trễ', () => {
    expect(classifyLabPartnerStatementItem({ status: 'REJECTED', sentAt: at('2026-10-01T00:00:00Z'), receivedAt: null, dueAt: at('2026-10-02T00:00:00Z') }, NOW)).toEqual({ state: 'REJECTED', late: false, turnaroundMinutes: null });
  });

  it('giờ nhận trước giờ gửi (ghi bù sai) không cho thời gian trả âm', () => {
    expect(classifyLabPartnerStatementItem({ status: 'RECEIVED', sentAt: at('2026-11-05T10:00:00Z'), receivedAt: at('2026-11-05T09:00:00Z'), dueAt: null }, NOW).turnaroundMinutes).toBe(0);
  });
});

describe('labPartnerStatementDate + isInLabPartnerStatementPeriod', () => {
  const sent = at('2026-11-02T01:00:00Z');
  const received = at('2026-11-04T01:00:00Z');

  it('theo ngày nhận: dòng đã nhận dùng ngày nhận, dòng chưa nhận rơi về ngày gửi', () => {
    expect(labPartnerStatementDate({ sentAt: sent, receivedAt: received }, 'RECEIVED')).toEqual(received);
    expect(labPartnerStatementDate({ sentAt: sent, receivedAt: null }, 'RECEIVED')).toEqual(sent);
  });

  it('theo ngày gửi: luôn dùng ngày gửi', () => {
    expect(labPartnerStatementDate({ sentAt: sent, receivedAt: received }, 'SENT')).toEqual(sent);
  });

  it('kỳ gồm cả hai đầu, bỏ trống = không giới hạn', () => {
    const from = at('2026-11-02T01:00:00Z');
    const to = at('2026-11-04T01:00:00Z');
    expect(isInLabPartnerStatementPeriod(from, from, to)).toBe(true);
    expect(isInLabPartnerStatementPeriod(to, from, to)).toBe(true);
    expect(isInLabPartnerStatementPeriod(at('2026-11-01T23:59:59Z'), from, to)).toBe(false);
    expect(isInLabPartnerStatementPeriod(at('2026-11-04T01:00:01Z'), from, to)).toBe(false);
    expect(isInLabPartnerStatementPeriod(at('2000-01-01T00:00:00Z'), null, null)).toBe(true);
  });
});

describe('matchesLabPartnerStatementFilter', () => {
  it('lọc theo trạng thái; "Quá hạn" gồm cả đã nhận trễ lẫn đang chờ quá hạn', () => {
    expect(matchesLabPartnerStatementFilter({ state: 'DONE', late: false }, 'ALL')).toBe(true);
    expect(matchesLabPartnerStatementFilter({ state: 'DONE', late: false }, 'DONE')).toBe(true);
    expect(matchesLabPartnerStatementFilter({ state: 'DONE', late: false }, 'WAITING')).toBe(false);
    expect(matchesLabPartnerStatementFilter({ state: 'DONE', late: true }, 'LATE')).toBe(true);
    expect(matchesLabPartnerStatementFilter({ state: 'WAITING', late: true }, 'LATE')).toBe(true);
    expect(matchesLabPartnerStatementFilter({ state: 'WAITING', late: false }, 'LATE')).toBe(false);
    expect(matchesLabPartnerStatementFilter({ state: 'REJECTED', late: false }, 'REJECTED')).toBe(true);
  });
});

describe('summarizeLabPartnerStatement', () => {
  it('chỉ mẫu đã có kết quả cộng vào số phát sinh; chờ kết quả là dự kiến; không nhận không tính tiền', () => {
    const t = summarizeLabPartnerStatement([
      { state: 'DONE', late: false, unitCost: 150_000 },
      { state: 'DONE', late: true, unitCost: 45_000 },
      { state: 'WAITING', late: true, unitCost: 90_000 },
      { state: 'WAITING', late: false, unitCost: 150_000 },
      { state: 'REJECTED', late: false, unitCost: 250_000 },
    ]);
    expect(t).toEqual({ doneCount: 2, doneAmount: 195_000, waitingCount: 2, waitingAmount: 240_000, rejectedCount: 1, lateCount: 2 });
  });

  it('không có dòng nào thì toàn số 0', () => {
    expect(summarizeLabPartnerStatement([])).toEqual({ doneCount: 0, doneAmount: 0, waitingCount: 0, waitingAmount: 0, rejectedCount: 0, lateCount: 0 });
  });
});
