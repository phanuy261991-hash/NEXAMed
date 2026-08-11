import { describe, expect, it } from 'vitest';
import { stripVietnameseDiacritics } from './strip-vietnamese-diacritics';

describe('stripVietnameseDiacritics', () => {
  it('bỏ dấu tổ hợp (nguyên âm có dấu) đúng', () => {
    expect(stripVietnameseDiacritics('Nguyễn Văn An')).toBe('nguyen van an');
    expect(stripVietnameseDiacritics('Trần Thị Bích')).toBe('tran thi bich');
  });

  it('xử lý chữ "đ"/"Đ" — không phải ký tự tổ hợp, unaccent chuẩn Postgres bỏ sót', () => {
    expect(stripVietnameseDiacritics('Đặng Đức Độ')).toBe('dang duc do');
  });

  it('giữ nguyên chuỗi đã là ASCII', () => {
    expect(stripVietnameseDiacritics('Nguyen Van An')).toBe('nguyen van an');
  });

  it('viết thường ký tự đã viết hoa không dấu', () => {
    expect(stripVietnameseDiacritics('HO CHI MINH')).toBe('ho chi minh');
  });

  it('xử lý đủ 5 thanh điệu + nguyên âm mở rộng tiếng Việt', () => {
    expect(stripVietnameseDiacritics('à á ả ã ạ')).toBe('a a a a a');
    expect(stripVietnameseDiacritics('ă ằ ắ ẳ ẵ ặ')).toBe('a a a a a a');
    expect(stripVietnameseDiacritics('â ầ ấ ẩ ẫ ậ')).toBe('a a a a a a');
    expect(stripVietnameseDiacritics('ê ề ế ể ễ ệ')).toBe('e e e e e e');
    expect(stripVietnameseDiacritics('ô ồ ố ổ ỗ ộ')).toBe('o o o o o o');
    expect(stripVietnameseDiacritics('ơ ờ ớ ở ỡ ợ')).toBe('o o o o o o');
    expect(stripVietnameseDiacritics('ư ừ ứ ử ữ ự')).toBe('u u u u u u');
  });
});
