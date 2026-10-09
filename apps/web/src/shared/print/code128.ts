/**
 * Mã vạch Code 128 thuần TypeScript (docs/DECISIONS.md #220 — tem ống nghiệm). Không phụ thuộc thư viện ngoài và không import giá trị từ `@nexamed/shared` (web không import được, #073).
 * Hỗ trợ tập B (ASCII 32–126) và tập C (cặp chữ số — mã toàn số như SID `2610080014` được nén còn một nửa độ dài nên vạch dày, quét chắc trên tem nhỏ).
 *
 * Mỗi ký hiệu là 6 phần tử xen kẽ vạch/khoảng trống (tổng 11 mô-đun), ký hiệu dừng 7 phần tử (13 mô-đun). `encodeCode128` trả về độ rộng từng phần tử theo mô-đun, bắt đầu bằng VẠCH.
 */
const PATTERNS: readonly string[] = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213',
  '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211',
  '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331',
  '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214',
  '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141',
  '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112',
];

const START_B = 104;
const START_C = 105;
const STOP = 106;

export const CODE128_QUIET_ZONE_MODULES = 10;

/** Chuỗi toàn chữ số, độ dài chẵn và ≥ 2 → dùng tập C (gọn nhất). */
function canUseSubsetC(text: string): boolean {
  return text.length >= 2 && text.length % 2 === 0 && /^\d+$/.test(text);
}

/** Dãy giá trị ký hiệu (gồm ký hiệu bắt đầu, kiểm tra, dừng) của `text`. Ném lỗi nếu có ký tự ngoài ASCII in được. */
export function code128Symbols(text: string): number[] {
  if (text === '') throw new Error('Mã vạch không được rỗng');
  const symbols: number[] = [];
  if (canUseSubsetC(text)) {
    symbols.push(START_C);
    for (let i = 0; i < text.length; i += 2) symbols.push(Number(text.slice(i, i + 2)));
  } else {
    symbols.push(START_B);
    for (const ch of text) {
      const code = ch.charCodeAt(0);
      if (code < 32 || code > 126) throw new Error(`Ký tự "${ch}" không mã hoá được bằng Code 128 tập B`);
      symbols.push(code - 32);
    }
  }
  let checksum = symbols[0]!;
  for (let i = 1; i < symbols.length; i += 1) checksum += symbols[i]! * i;
  symbols.push(checksum % 103, STOP);
  return symbols;
}

/** Độ rộng (theo mô-đun) của từng phần tử vạch/khoảng trống, bắt đầu bằng vạch — chưa gồm vùng trống hai bên. */
export function encodeCode128(text: string): number[] {
  return code128Symbols(text).flatMap((symbol) => [...PATTERNS[symbol]!].map(Number));
}

export interface Code128Bar {
  /** Vị trí bắt đầu (mô-đun) tính từ mép trái vùng trống. */
  x: number;
  width: number;
}

/** Danh sách VẠCH (bỏ khoảng trống) và tổng số mô-đun kể cả vùng trống hai bên — để vẽ SVG. */
export function code128Bars(text: string): { bars: Code128Bar[]; totalModules: number } {
  const widths = encodeCode128(text);
  const bars: Code128Bar[] = [];
  let x = CODE128_QUIET_ZONE_MODULES;
  widths.forEach((w, index) => {
    if (index % 2 === 0) bars.push({ x, width: w });
    x += w;
  });
  return { bars, totalModules: x + CODE128_QUIET_ZONE_MODULES };
}
