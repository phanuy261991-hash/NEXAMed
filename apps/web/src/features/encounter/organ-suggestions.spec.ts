import { describe, expect, it } from 'vitest';
import { ORGAN_KEYS, ORGAN_SYSTEMS, insertOrganHeadings, organsPresent, stripEmptyOrganHeadings } from './organ-suggestions';

describe('danh sách cơ quan', () => {
  it('đúng 10 mục theo mục "2. Các cơ quan" của mẫu Nội khoa 01/BV-01, khoá không trùng', () => {
    expect(ORGAN_SYSTEMS.map((o) => o.label)).toEqual([
      'Tuần hoàn',
      'Hô hấp',
      'Tiêu hoá',
      'Thận – Tiết niệu – Sinh dục',
      'Thần kinh',
      'Cơ – Xương – Khớp',
      'Tai – Mũi – Họng',
      'Răng – Hàm – Mặt',
      'Mắt',
      'Nội tiết – dinh dưỡng và các bệnh lý khác',
    ]);
    expect(new Set(ORGAN_KEYS).size).toBe(10);
  });
});

describe('organsPresent', () => {
  it('nhận ra cơ quan đã có tiêu đề ở đầu dòng (kể cả dòng thụt lề), không nhận chữ giữa câu', () => {
    const text = 'Răng – Hàm – Mặt: sâu răng 36.\n  Tuần hoàn: tim đều.\nKhám thấy hô hấp: bình thường';
    expect([...organsPresent(text)].sort()).toEqual(['circulatory', 'dental']);
  });

  it('ô trống → không có cơ quan nào', () => {
    expect(organsPresent('').size).toBe(0);
  });
});

describe('insertOrganHeadings', () => {
  it('ô trống: chèn đúng thứ tự của mẫu (không theo thứ tự bấm), con trỏ sau dấu hai chấm của dòng đầu', () => {
    const r = insertOrganHeadings('', ['respiratory', 'circulatory']);
    expect(r.text).toBe('Tuần hoàn: \nHô hấp: ');
    expect(r.text.slice(0, r.caret)).toBe('Tuần hoàn: ');
  });

  it('ô đang có chữ chưa xuống dòng: thêm xuống dòng rồi chèn cuối ô', () => {
    const r = insertOrganHeadings('Tim đều, phổi trong', ['digestive']);
    expect(r.text).toBe('Tim đều, phổi trong\nTiêu hoá: ');
    expect(r.caret).toBe(r.text.length);
  });

  it('ô đã kết thúc bằng xuống dòng: không thêm dòng trống', () => {
    expect(insertOrganHeadings('Ghi chú\n', ['eye']).text).toBe('Ghi chú\nMắt: ');
  });

  it('cơ quan đã có trong ô thì KHÔNG chèn lần hai', () => {
    const text = 'Răng – Hàm – Mặt: sâu răng 36.';
    const r = insertOrganHeadings(text, ['dental', 'eye']);
    expect(r.text).toBe(`${text}\nMắt: `);
  });

  it('chỉ chọn cơ quan đã có / không chọn gì → giữ nguyên ô, con trỏ ở cuối', () => {
    expect(insertOrganHeadings('Mắt: bình thường', ['eye'])).toEqual({ text: 'Mắt: bình thường', caret: 'Mắt: bình thường'.length });
    expect(insertOrganHeadings('abc', [])).toEqual({ text: 'abc', caret: 3 });
  });

  it('bỏ qua khoá lạ', () => {
    expect(insertOrganHeadings('', ['khong-co']).text).toBe('');
  });
});

describe('stripEmptyOrganHeadings', () => {
  it('bỏ dòng chỉ có tiêu đề cơ quan; giữ dòng đã có chữ và mọi dòng khác', () => {
    const text = 'Răng – Hàm – Mặt: sâu răng 36.\nTuần hoàn: tim đều.\nHô hấp: ';
    expect(stripEmptyOrganHeadings(text)).toBe('Răng – Hàm – Mặt: sâu răng 36.\nTuần hoàn: tim đều.');
  });

  it('nhiều dòng trống ở giữa/cuối: bỏ hết và cắt khoảng trắng thừa cuối', () => {
    expect(stripEmptyOrganHeadings('Hô hấp: \nMắt:\nBụng mềm\nThần kinh:  \n')).toBe('Bụng mềm');
  });

  it('toàn tiêu đề trống → chuỗi rỗng', () => {
    expect(stripEmptyOrganHeadings('Tuần hoàn: \nHô hấp: ')).toBe('');
  });

  it('không có dòng tiêu đề trống → trả nguyên văn (không đụng khoảng trắng người dùng gõ)', () => {
    const text = 'Tim đều.  \n\nPhổi trong\n';
    expect(stripEmptyOrganHeadings(text)).toBe(text);
  });

  it('dòng chỉ GỒM chữ giống tiêu đề nhưng có nội dung thật sau đó thì giữ', () => {
    expect(stripEmptyOrganHeadings('Mắt: nhìn mờ mắt phải')).toBe('Mắt: nhìn mờ mắt phải');
  });

  it('chèn rồi lưu mà chưa gõ gì → ô trở về như trước khi chèn', () => {
    const before = 'Tim đều, phổi trong';
    const { text } = insertOrganHeadings(before, ['circulatory', 'eye']);
    expect(stripEmptyOrganHeadings(text)).toBe(before);
  });
});
