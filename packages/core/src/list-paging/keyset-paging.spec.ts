import { describe, expect, it } from 'vitest';
import { decodeKeysetCursor, encodeKeysetCursor, pageAfterCursor } from './keyset-paging';

type Row = { at: string; id: string };
const keyOf = (r: Row) => ({ sortKey: r.at, id: r.id });
const rows: Row[] = Array.from({ length: 10 }, (_, i) => ({ at: `2026-10-22T0${Math.floor(i / 3)}:00:00.000Z`, id: `id-${String(i).padStart(2, '0')}` }));

describe('keyset paging', () => {
  it('con trỏ mã hoá rồi giải mã ra đúng giá trị, kể cả ký tự đặc biệt', () => {
    const p = { sortKey: '2026-10-22T01:00:00.000Z', id: 'a|b"c/é' };
    expect(decodeKeysetCursor(encodeKeysetCursor(p))).toEqual(p);
  });

  it('con trỏ hỏng/không đúng khuôn → null (không ném lỗi)', () => {
    expect(decodeKeysetCursor('khong-phai-con-tro')).toBeNull();
    expect(decodeKeysetCursor(Buffer.from('{"a":1}').toString('base64url'))).toBeNull();
    expect(decodeKeysetCursor(Buffer.from('[1,2]').toString('base64url'))).toBeNull();
    expect(decodeKeysetCursor('')).toBeNull();
  });

  it('trang đầu, trang giữa, trang cuối: đủ phần tử, không trùng, nextCursor null ở trang cuối', () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    const sizes: number[] = [];
    for (let guard = 0; guard < 10; guard++) {
      const result: { page: Row[]; nextCursor: string | null } = pageAfterCursor(rows, keyOf, { limit: 4, cursor: cursor ? decodeKeysetCursor(cursor) : null });
      const { page, nextCursor } = result;
      sizes.push(page.length);
      seen.push(...page.map((r) => r.id));
      cursor = nextCursor;
      if (!cursor) break;
    }
    expect(sizes).toEqual([4, 4, 2]);
    expect(seen).toEqual(rows.map((r) => r.id));
  });

  it('số phần tử chia hết cho limit: trang cuối đầy nhưng nextCursor vẫn null (không có trang rỗng thừa)', () => {
    const { page, nextCursor } = pageAfterCursor(rows.slice(0, 8), keyOf, { limit: 4, cursor: decodeKeysetCursor(encodeKeysetCursor(keyOf(rows[3]!))) });
    expect(page.map((r) => r.id)).toEqual(['id-04', 'id-05', 'id-06', 'id-07']);
    expect(nextCursor).toBeNull();
  });

  it('danh sách rỗng → trang rỗng, nextCursor null', () => {
    expect(pageAfterCursor([], keyOf, { limit: 5 })).toEqual({ page: [], nextCursor: null });
  });

  it('dòng MỚI chèn vào cuối trong lúc cuộn không làm trùng/sót dòng ở lần tải sau', () => {
    const first = pageAfterCursor(rows, keyOf, { limit: 5 });
    const grown = [...rows, { at: '2026-10-22T05:00:00.000Z', id: 'id-new' }];
    const second = pageAfterCursor(grown, keyOf, { limit: 5, cursor: decodeKeysetCursor(first.nextCursor!) });
    expect(second.page.map((r) => r.id)).toEqual(['id-05', 'id-06', 'id-07', 'id-08', 'id-09']);
    const third = pageAfterCursor(grown, keyOf, { limit: 5, cursor: decodeKeysetCursor(second.nextCursor!) });
    expect(third.page.map((r) => r.id)).toEqual(['id-new']);
    expect(third.nextCursor).toBeNull();
  });

  it('dòng đứng TRƯỚC con trỏ bị xoá/đổi chỗ không làm lùi trang (theo khoá, không theo vị trí)', () => {
    const first = pageAfterCursor(rows, keyOf, { limit: 5 });
    const without = rows.filter((r) => r.id !== 'id-01');
    const second = pageAfterCursor(without, keyOf, { limit: 5, cursor: decodeKeysetCursor(first.nextCursor!) });
    expect(second.page.map((r) => r.id)).toEqual(['id-05', 'id-06', 'id-07', 'id-08', 'id-09']);
  });

  it('cùng sortKey: phân biệt bằng id, không lặp dòng giữa hai trang', () => {
    const same: Row[] = ['a', 'b', 'c', 'd'].map((id) => ({ at: 'T', id }));
    const first = pageAfterCursor(same, keyOf, { limit: 2 });
    const second = pageAfterCursor(same, keyOf, { limit: 2, cursor: decodeKeysetCursor(first.nextCursor!) });
    expect([...first.page, ...second.page].map((r) => r.id)).toEqual(['a', 'b', 'c', 'd']);
  });
});
