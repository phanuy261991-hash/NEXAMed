import { describe, expect, it } from 'vitest';
import { clsKindOf, summarizeCls, summarizeDiagnoses, type ClsKindRaw } from './clinical-report-math';

describe('summarizeDiagnoses', () => {
  it('xếp nhiều lượt nhất trước, hoà thì theo mã; tỉ lệ trên số lượt có chẩn đoán', () => {
    const r = summarizeDiagnoses({
      completedVisits: 12,
      withDiagnosis: 10,
      distinctCodes: 3,
      rows: [
        { code: 'J06', name: 'Nhiễm trùng hô hấp trên', visits: 3, patients: 3 },
        { code: 'A09', name: 'Tiêu chảy', visits: 5, patients: 4 },
        { code: 'B34', name: 'Nhiễm virus', visits: 2, patients: 2 },
      ],
      chapters: [
        { chapterCode: 'X', chapterName: 'Hô hấp', visits: 3 },
        { chapterCode: 'I', chapterName: 'Nhiễm trùng', visits: 7 },
      ],
    });
    expect(r.rows.map((x) => x.code)).toEqual(['A09', 'J06', 'B34']);
    expect(r.rows[0]!.percent).toBe(50);
    expect(r.chapters.map((c) => c.chapterCode)).toEqual(['I', 'X']);
    expect(r.chapters[0]!.percent).toBe(70);
    expect(r.summary).toEqual({ completedVisits: 12, withDiagnosis: 10, withoutDiagnosis: 2, distinctCodes: 3, topCode: 'A09', topCodeName: 'Tiêu chảy' });
  });
  it('hoà số lượt thì mã nhỏ hơn trước', () => {
    const r = summarizeDiagnoses({ completedVisits: 2, withDiagnosis: 2, distinctCodes: 2, rows: [{ code: 'B', name: '', visits: 1, patients: 1 }, { code: 'A', name: '', visits: 1, patients: 1 }], chapters: [] });
    expect(r.rows.map((x) => x.code)).toEqual(['A', 'B']);
  });
  it('không có chẩn đoán nào: tỉ lệ null, mã đầu null, không âm số lượt thiếu chẩn đoán', () => {
    const r = summarizeDiagnoses({ completedVisits: 0, withDiagnosis: 0, distinctCodes: 0, rows: [], chapters: [] });
    expect(r.summary).toMatchObject({ topCode: null, withoutDiagnosis: 0 });
    const bad = summarizeDiagnoses({ completedVisits: 1, withDiagnosis: 3, distinctCodes: 1, rows: [], chapters: [] });
    expect(bad.summary.withoutDiagnosis).toBe(0);
  });
});

describe('clsKindOf', () => {
  it('nhận 3 nhóm dịch vụ, còn lại là OTHER', () => {
    expect(['LAB', 'IMAGING', 'FUNCTIONAL', null, 'KHAC'].map(clsKindOf)).toEqual(['LAB', 'IMAGING', 'FUNCTIONAL', 'OTHER', 'OTHER']);
  });
});

describe('summarizeCls', () => {
  const rows: ClsKindRaw[] = [
    { kind: 'LAB', inHouse: true, ordered: 10, completed: 8, measured: 8, sumMinutes: 480, lateCompleted: 1, overdueOpen: 1 },
    { kind: 'LAB', inHouse: false, ordered: 2, completed: 0, measured: 0, sumMinutes: 0, lateCompleted: 0, overdueOpen: 0 },
    { kind: 'IMAGING', inHouse: true, ordered: 4, completed: 4, measured: 2, sumMinutes: 100, lateCompleted: 0, overdueOpen: 0 },
    { kind: 'OTHER', inHouse: false, ordered: 3, completed: 0, measured: 0, sumMinutes: 0, lateCompleted: 0, overdueOpen: 0 },
  ];
  it('tổng quan: số chỉ định, tại phòng khám/ra ngoài, chưa trả, trung bình, quá hạn', () => {
    const { summary } = summarizeCls(rows);
    expect(summary).toEqual({ ordered: 19, inHouse: 14, external: 5, completed: 12, pending: 2, avgMinutes: 58, overdue: 2, overdueOpen: 1, lateCompleted: 1 });
  });
  it('theo nhóm: đúng thứ tự, gộp tại phòng khám và ra ngoài, nhóm trống không hiện', () => {
    const { byKind } = summarizeCls(rows);
    expect(byKind.map((k) => k.kind)).toEqual(['LAB', 'IMAGING', 'OTHER']);
    expect(byKind[0]).toEqual({ kind: 'LAB', ordered: 12, inHouse: 10, external: 2, completed: 8, avgMinutes: 60, overdue: 2 });
    expect(byKind[1]).toMatchObject({ avgMinutes: 50, overdue: 0 });
    expect(byKind[2]).toMatchObject({ avgMinutes: null, inHouse: 0, external: 3 });
  });
  it('không có chỉ định nào: mọi số 0, trung bình null', () => {
    const r = summarizeCls([]);
    expect(r.byKind).toEqual([]);
    expect(r.summary).toMatchObject({ ordered: 0, pending: 0, avgMinutes: null, overdue: 0 });
  });
});
