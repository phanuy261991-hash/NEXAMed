/**
 * Bỏ dấu tiếng Việt + viết thường — dùng để chuẩn hoá đầu vào tìm kiếm ở tầng ứng dụng, khớp với
 * cột `search_key` sinh ở tầng DB (Postgres `unaccent` + thay chữ "d gạch ngang" thủ công +
 * `lower`, xem migration `*_patient_search`). Hai bên PHẢI cho cùng kết quả với cùng input —
 * `unaccent` chuẩn của Postgres tách được các dấu tổ hợp (Unicode combining mark, phần lớn dấu
 * tiếng Việt) nhưng KHÔNG xử lý chữ "d gạch ngang" (không phải ký tự tổ hợp, là chữ cái riêng,
 * mã U+0111/U+0110) — cả hai phía đều phải tự xử lý riêng trường hợp này.
 *
 * Dùng `String.prototype.normalize('NFD')` để tách chữ cái khỏi dấu (theo chuẩn Unicode, cùng cơ
 * chế `unaccent` của Postgres dùng), rồi xoá dải combining diacritical mark U+0300-U+036F. Dùng
 * mã hex thay vì gõ trực tiếp ký tự tổ hợp trong regex — ký tự combining mark literal dễ vỡ mã hoá
 * khi copy/paste qua nhiều lớp công cụ, gõ qua `String.fromCharCode`/hex code point ổn định hơn.
 */
const COMBINING_DIACRITICAL_MARKS_START = 0x0300;
const COMBINING_DIACRITICAL_MARKS_END = 0x036f;
const D_WITH_STROKE_LOWER = String.fromCharCode(0x0111);
const D_WITH_STROKE_UPPER = String.fromCharCode(0x0110);

function isCombiningDiacriticalMark(codePoint: number): boolean {
  return codePoint >= COMBINING_DIACRITICAL_MARKS_START && codePoint <= COMBINING_DIACRITICAL_MARKS_END;
}

export function stripVietnameseDiacritics(text: string): string {
  const normalized = text.normalize('NFD');
  let result = '';
  for (const ch of normalized) {
    if (isCombiningDiacriticalMark(ch.codePointAt(0) ?? 0)) {
      continue;
    }
    result += ch;
  }
  return result
    .split(D_WITH_STROKE_LOWER)
    .join('d')
    .split(D_WITH_STROKE_UPPER)
    .join('D')
    .toLowerCase();
}
