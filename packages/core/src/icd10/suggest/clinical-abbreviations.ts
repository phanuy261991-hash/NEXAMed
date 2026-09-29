/**
 * Từ điển viết tắt/đồng nghĩa dùng khi gợi ý mã ICD-10 từ ô "Chẩn đoán" (docs/DECISIONS.md — "Gợi ý
 * mã ICD-10"). CHỈ đổi chữ thành chữ (mở rộng viết tắt / chuẩn hoá cách gọi), KHÔNG map thẳng ra
 * mã ICD — mã luôn lấy từ `icd10_catalog` (danh mục Bộ Y tế), đúng ràng buộc "không tự sinh, tự map
 * mã" của CLAUDE.md. Danh sách nháp đã được chủ dự án duyệt (2026-09-29), bổ sung dần theo phản hồi
 * từ pilot.
 *
 * Khoá viết thường, khớp NGUYÊN TỪ và đúng từng biến thể được khai báo (cả "đtđ" lẫn "dtd" đều có
 * khoá riêng) — cố ý KHÔNG tự bỏ dấu để khớp: "cam" (không dấu) không được hiểu thành "cảm".
 */
const CLINICAL_ABBREVIATIONS: Readonly<Record<string, string>> = {
  tha: 'tăng huyết áp',
  đtđ: 'đái tháo đường',
  dtd: 'đái tháo đường',
  type: 'típ',
  tip: 'típ',
  sxh: 'sốt xuất huyết',
  vpq: 'viêm phế quản',
  rlth: 'rối loạn tiêu hóa',
  nktn: 'nhiễm trùng tiết niệu',
  gerd: 'trào ngược dạ dày thực quản',
  cảm: 'viêm mũi họng cấp tính',
};

/** Nếu `word` (đã viết thường) là viết tắt trong từ điển thì trả bản mở rộng, ngược lại `null`. */
export function lookupClinicalAbbreviation(word: string): string | null {
  return Object.hasOwn(CLINICAL_ABBREVIATIONS, word) ? (CLINICAL_ABBREVIATIONS[word] ?? null) : null;
}
