import { describe, expect, it } from 'vitest';
import { numberToVietnameseWords, quantityInWords } from './vietnamese-number-words';

describe('numberToVietnameseWords', () => {
  it.each([
    [0, 'không'],
    [1, 'một'],
    [6, 'sáu'],
    [10, 'mười'],
    [11, 'mười một'],
    [15, 'mười lăm'],
    [20, 'hai mươi'],
    [21, 'hai mươi mốt'],
    [25, 'hai mươi lăm'],
    [99, 'chín mươi chín'],
    [100, 'một trăm'],
    [101, 'một trăm lẻ một'],
    [105, 'một trăm lẻ năm'],
    [110, 'một trăm mười'],
    [115, 'một trăm mười lăm'],
    [999, 'chín trăm chín mươi chín'],
    [1000, 'một nghìn'],
    [1005, 'một nghìn không trăm lẻ năm'],
    [1010, 'một nghìn không trăm mười'],
    [12345, 'mười hai nghìn ba trăm bốn mươi lăm'],
    [100000, 'một trăm nghìn'],
    [1000000, 'một triệu'],
    [2000015, 'hai triệu không trăm mười lăm'],
  ])('%i → %s', (n, words) => {
    expect(numberToVietnameseWords(n)).toBe(words);
  });

  it('số lẻ làm tròn LÊN (khớp số lượng phát thuốc); số âm/vô hạn không bị đọc sai', () => {
    expect(numberToVietnameseWords(5.25)).toBe('sáu');
    expect(numberToVietnameseWords(-1)).toBe('-1');
    expect(numberToVietnameseWords(Number.POSITIVE_INFINITY)).toBe('Infinity');
  });
});

describe('quantityInWords', () => {
  it('chữ đầu viết hoa, kèm đơn vị', () => {
    expect(quantityInWords(6, 'viên')).toBe('Sáu viên');
    expect(quantityInWords(21, 'ống')).toBe('Hai mươi mốt ống');
    expect(quantityInWords(6, 'Viên')).toBe('Sáu viên');
  });
  it('không có đơn vị thì chỉ in số bằng chữ', () => {
    expect(quantityInWords(10, '')).toBe('Mười');
  });
});
