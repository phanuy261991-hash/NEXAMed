import { describe, expect, it } from 'vitest';
import { COPYRIGHT_INFO, formatCopyrightLine, listSupportContacts, type CopyrightInfo } from './copyright-info';

const base: CopyrightInfo = { owner: null, startYear: 2026, hotline: null, email: null, website: null };

describe('formatCopyrightLine', () => {
  it('chưa có đơn vị sở hữu thì ghi tên sản phẩm', () => {
    expect(formatCopyrightLine(base, 2026)).toBe('© 2026 NEXA Med. Bảo lưu mọi quyền.');
  });
  it('có đơn vị sở hữu và qua năm thì ghi khoảng năm', () => {
    expect(formatCopyrightLine({ ...base, owner: 'Công ty A' }, 2028)).toBe('© 2026–2028 Công ty A. Bảo lưu mọi quyền.');
  });
  it('năm hiện tại nhỏ hơn hoặc bằng năm đầu thì chỉ ghi năm đầu', () => {
    expect(formatCopyrightLine(base, 2025)).toBe('© 2026 NEXA Med. Bảo lưu mọi quyền.');
  });
});

describe('listSupportContacts', () => {
  it('bỏ dòng chưa có thông tin hoặc chỉ toàn dấu cách, giữ đúng thứ tự', () => {
    expect(listSupportContacts({ ...base, hotline: '1900 0000', email: '  ', website: 'nexamed.example' })).toEqual([
      { label: 'Hỗ trợ', value: '1900 0000' },
      { label: 'Trang web', value: 'nexamed.example' },
    ]);
  });
  it('chưa có gì thì rỗng (khai báo mặc định của dự án chưa điền thông tin liên hệ)', () => {
    expect(listSupportContacts(COPYRIGHT_INFO)).toEqual([]);
  });
});
