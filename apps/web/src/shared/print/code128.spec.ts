import { describe, expect, it } from 'vitest';
import { code128Bars, code128Symbols, encodeCode128 } from './code128';

describe('code128Symbols', () => {
  it('mã toàn số độ dài chẵn dùng tập C: start C + từng cặp số + kiểm tra + dừng', () => {
    // "2610080014": start C(105), 26, 10, 08, 00, 14. Kiểm tra = (105 + 26*1 + 10*2 + 8*3 + 0*4 + 14*5) mod 103 = 245 mod 103 = 39.
    expect(code128Symbols('2610080014')).toEqual([105, 26, 10, 8, 0, 14, 39, 106]);
  });

  it('mã có chữ hoặc độ dài lẻ dùng tập B: start B + (mã ASCII − 32)', () => {
    // "PJJ123": start B(104), P=48, J=42, J=42, 1=17, 2=18, 3=19. Kiểm tra = (104+48+84+126+68+90+114) mod 103 = 634 mod 103 = 16.
    expect(code128Symbols('PJJ123')).toEqual([104, 48, 42, 42, 17, 18, 19, 16, 106]);
    expect(code128Symbols('123')[0]).toBe(104); // lẻ → tập B
  });

  it('từ chối chuỗi rỗng và ký tự ngoài ASCII in được', () => {
    expect(() => code128Symbols('')).toThrow();
    expect(() => code128Symbols('Đ123')).toThrow();
  });
});

describe('encodeCode128', () => {
  it('mỗi ký hiệu thường dài 11 mô-đun, ký hiệu dừng 13; tổng chiều rộng khớp công thức', () => {
    const symbols = code128Symbols('2610080014');
    const widths = encodeCode128('2610080014');
    const total = widths.reduce((a, b) => a + b, 0);
    expect(total).toBe(11 * (symbols.length - 1) + 13);
    // Số phần tử: 6 mỗi ký hiệu thường + 7 ký hiệu dừng — kết thúc bằng VẠCH nên số phần tử lẻ.
    expect(widths).toHaveLength(6 * (symbols.length - 1) + 7);
  });

  it('bắt đầu bằng ký hiệu start C (211232) và kết thúc bằng ký hiệu dừng (2331112)', () => {
    const joined = encodeCode128('2610080014').join('');
    expect(joined.startsWith('211232')).toBe(true);
    expect(joined.endsWith('2331112')).toBe(true);
  });

  it('chỉ chứa độ rộng 1–4 mô-đun', () => {
    for (const text of ['2610080014', 'ABC-123', 'SH261008001']) {
      expect(encodeCode128(text).every((w) => w >= 1 && w <= 4)).toBe(true);
    }
  });
});

describe('code128Bars', () => {
  it('có vùng trống 10 mô-đun hai bên và các vạch không chồng nhau', () => {
    const { bars, totalModules } = code128Bars('2610080014');
    expect(bars[0]!.x).toBe(10);
    for (let i = 1; i < bars.length; i += 1) expect(bars[i]!.x).toBeGreaterThanOrEqual(bars[i - 1]!.x + bars[i - 1]!.width);
    const last = bars[bars.length - 1]!;
    expect(totalModules).toBe(last.x + last.width + 10);
  });
});
