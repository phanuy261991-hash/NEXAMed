import { describe, expect, it } from 'vitest';
import { layoutOverflowTabs } from './overflow-tabs-layout';

const ids = ['kham', 'dieutri', 'donthuoc', 'chidinh', 'ketqua', 'vattu', 'hinhanh'];
const priorityIds = ['kham', 'donthuoc', 'chidinh', 'ketqua', 'dieutri', 'hinhanh', 'vattu'];
const widths = { kham: 150, dieutri: 160, donthuoc: 110, chidinh: 130, ketqua: 130, vattu: 80, hinhanh: 110 };
const base = { ids, priorityIds, widths, moreWidth: 80, gap: 6 };

describe('layoutOverflowTabs', () => {
  it('đủ chỗ thì hiện hết, không có menu', () => {
    const r = layoutOverflowTabs({ ...base, available: 2000, activeId: 'kham' });
    expect(r.visible).toEqual(ids);
    expect(r.overflow).toEqual([]);
  });

  it('thiếu chỗ thì lấy theo ưu tiên, giữ thứ tự gốc trên thanh', () => {
    // room = 700 - 80 - 6 = 614: kham 150 + donthuoc 110 + chidinh 130 + ketqua 130 + gaps 18 = 538; thêm dieutri (160+6) vượt 614.
    const r = layoutOverflowTabs({ ...base, available: 700, activeId: 'kham' });
    expect(r.visible).toEqual(['kham', 'donthuoc', 'chidinh', 'ketqua']);
    expect(r.overflow).toEqual(['dieutri', 'vattu', 'hinhanh']);
  });

  it('tab đang chọn nằm trong menu thì hiện lên thanh, nhường chỗ tab ưu tiên thấp nhất', () => {
    const r = layoutOverflowTabs({ ...base, available: 700, activeId: 'dieutri' });
    expect(r.visible).toContain('dieutri');
    expect(r.visible).not.toContain('ketqua');
    expect(r.visible).toEqual(['kham', 'dieutri', 'donthuoc', 'chidinh']);
    expect(r.overflow).toEqual(['ketqua', 'vattu', 'hinhanh']);
  });

  it('tab đang chọn luôn hiện kể cả khi rất chật', () => {
    const r = layoutOverflowTabs({ ...base, available: 300, activeId: 'hinhanh' });
    expect(r.visible).toEqual(['hinhanh']);
    expect(r.overflow).toHaveLength(6);
  });

  it('bỏ qua id ưu tiên không có trong danh sách (tab bị ẩn theo quyền)', () => {
    const r = layoutOverflowTabs({ ...base, ids: ['kham', 'donthuoc'], available: 100, activeId: 'kham' });
    expect(r.visible.concat(r.overflow).sort()).toEqual(['donthuoc', 'kham']);
    expect(r.visible).toContain('kham');
  });

  it('chưa đo được (bề rộng 0) thì hiện hết', () => {
    const r = layoutOverflowTabs({ ...base, widths: {}, moreWidth: 0, available: 0, activeId: 'kham' });
    expect(r.overflow).toEqual([]);
  });
});
