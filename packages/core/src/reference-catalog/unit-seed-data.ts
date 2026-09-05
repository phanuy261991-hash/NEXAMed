/**
 * Dữ liệu khởi tạo danh mục "Đơn vị tính" (`reference_catalog` category `UNIT`) — chủ dự án cung
 * cấp qua `docs/data/don-vi-tinh.md` (copy byte-for-byte vào repo, đúng tiền lệ
 * `docs/data/allergen-catalog.md`). Nhúng trực tiếp thành mảng TS (quy mô nhỏ, không cần kỹ thuật
 * JSON string như ICD-10). Thứ tự giữ đúng thứ tự xuất hiện trong file gốc.
 *
 * File gốc liệt kê 48 dòng nhưng "Gói" xuất hiện 2 lần (dòng "Hộp/Gói/Túi" và lại một lần riêng
 * gần cuối, ngay trước "Liệu trình") — giữ lại DÒNG ĐẦU TIÊN, bỏ dòng lặp thứ 2 (không phải bỏ
 * sót): còn lại đúng 47 đơn vị KHÔNG trùng tên. `seedReferenceCatalog()` (apps/api) idempotent
 * THEO TÊN (không theo `code`, giống `seedAllergenCatalog()`) — category `UNIT` dùng mã NGẮN, TUẦN
 * TỰ tự sinh lúc seed (`REFERENCE_CATALOG_SHORT_CODE_PREFIXES.UNIT = 'DV'`, docs/DECISIONS.md
 * #113), nguồn dữ liệu này không có mã chính thức để giữ nguyên.
 *
 * Cột "Mô tả" của file gốc là ký hiệu viết tắt (ví dụ "Microgam" → "µg") — map thẳng vào cột
 * `reference_catalog.description` (đã có sẵn, hiện chỉ dùng cho category UNIT).
 */
export interface UnitSeedItem {
  name: string;
  description: string;
}

export const UNIT_SEED_ITEMS: readonly UnitSeedItem[] = [
  { name: 'Cái', description: 'Cái' },
  { name: 'Chiếc', description: 'Chiếc' },
  { name: 'Viên', description: 'Viên' },
  { name: 'Nang', description: 'Nang' },
  { name: 'Ống', description: 'Ống' },
  { name: 'Lọ', description: 'Lọ' },
  { name: 'Chai', description: 'Chai' },
  { name: 'Tuýp', description: 'Tuýp' },
  { name: 'Hộp', description: 'Hộp' },
  { name: 'Gói', description: 'Gói' },
  { name: 'Túi', description: 'Túi' },
  { name: 'Bộ', description: 'Bộ' },
  { name: 'Vỉ', description: 'Vỉ' },
  { name: 'Cuộn', description: 'Cuộn' },
  { name: 'Miếng', description: 'Miếng' },
  { name: 'Tấm', description: 'Tấm' },
  { name: 'Que', description: 'Que' },
  { name: 'Thanh', description: 'Thanh' },
  { name: 'Đôi', description: 'Đôi' },
  { name: 'Cặp', description: 'Cặp' },
  { name: 'Bơm', description: 'Bơm' },
  { name: 'Microgam', description: 'µg' },
  { name: 'Miligam', description: 'mg' },
  { name: 'Gam', description: 'g' },
  { name: 'Kilôgam', description: 'kg' },
  { name: 'Microlit', description: 'µL' },
  { name: 'Mililit', description: 'mL' },
  { name: 'Lít', description: 'L' },
  { name: 'Liều', description: 'Liều' },
  { name: 'Giọt', description: 'Giọt' },
  { name: 'Nhát', description: 'Nhát' },
  { name: 'Lần', description: 'Lần' },
  { name: 'Test', description: 'Test' },
  { name: 'Mẫu', description: 'Mẫu' },
  { name: 'Kit', description: 'Kit' },
  { name: 'Panel', description: 'Panel' },
  { name: 'Cassette', description: 'Cassette' },
  { name: 'Plate', description: 'Plate' },
  { name: 'Well', description: 'Well' },
  { name: 'Ca', description: 'Ca' },
  { name: 'Buổi', description: 'Buổi' },
  { name: 'Giờ', description: 'Giờ' },
  { name: 'Ngày', description: 'Ngày' },
  { name: 'Phiên', description: 'Phiên' },
  { name: 'Liệu trình', description: 'Liệu trình' },
  { name: 'Tháng', description: 'Tháng' },
  { name: 'Năm', description: 'Năm' },
];
