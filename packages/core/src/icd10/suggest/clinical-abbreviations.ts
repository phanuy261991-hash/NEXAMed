import { normalizeIcd10AbbreviationCode } from '@nexamed/shared';

/**
 * Từ điển viết tắt/đồng nghĩa dùng khi gợi ý mã ICD-10 từ ô "Chẩn đoán" (docs/DECISIONS.md — "Gợi ý
 * mã ICD-10"). CHỈ đổi chữ thành chữ (mở rộng viết tắt / chuẩn hoá cách gọi), KHÔNG map thẳng ra
 * mã ICD — mã luôn lấy từ `icd10_catalog` (danh mục Bộ Y tế), đúng ràng buộc "không tự sinh, tự map
 * mã" của CLAUDE.md.
 *
 * Dữ liệu do `clinic_admin` quản lý ở bảng `reference_catalog` category `ICD10_ABBREVIATION` (#206,
 * trước đó là danh sách tĩnh trong file này) — hàm thuần này chỉ nhận danh sách đã đọc sẵn từ DB.
 * Khớp NGUYÊN TỪ và đúng từng biến thể được khai báo (cả "đtđ" lẫn "dtd" đều có mục riêng), cố ý
 * KHÔNG tự bỏ dấu để khớp: "cam" (không dấu) không được hiểu thành "cảm".
 */
export interface AbbreviationEntry {
  /** Từ viết tắt — chuẩn hoá (chữ thường + NFC) bên trong `buildAbbreviationLookup`, truyền thô cũng được. */
  abbreviation: string;
  /** Cách viết đầy đủ ("tăng huyết áp"). */
  expansion: string;
}

/** Nếu `word` (đã viết thường, NFC — đúng đầu ra `tokenizeVietnamese`) là viết tắt thì trả bản mở rộng, ngược lại `null`. */
export type AbbreviationLookup = (word: string) => string | null;

export function buildAbbreviationLookup(entries: readonly AbbreviationEntry[]): AbbreviationLookup {
  const byKey = new Map<string, string>();
  for (const { abbreviation, expansion } of entries) {
    const key = normalizeIcd10AbbreviationCode(abbreviation);
    const value = expansion.trim();
    if (key !== '' && value !== '') {
      byKey.set(key, value);
    }
  }
  return (word) => byKey.get(word) ?? null;
}
