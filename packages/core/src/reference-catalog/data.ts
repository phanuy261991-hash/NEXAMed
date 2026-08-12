/**
 * Nguồn sự thật của dữ liệu seed `reference_catalog` (danh mục Dân tộc/Quốc tịch dùng chung
 * toàn hệ thống) — dùng bởi seed script (apps/api) và test. Sửa danh sách thì sửa ở đây, không
 * sửa trực tiếp dữ liệu trong DB (seed là idempotent, chạy lại để đồng bộ).
 *
 * Dữ liệu lấy nguyên văn từ 2 file chủ dự án cung cấp — không tự thêm/bớt/sửa chính tả:
 * - ETHNICITY_ITEMS: "Danh_sach_54_dan_toc_Viet_Nam.md" — code = cột "Mã Dân Tộc" (1-54, không
 *   zero-pad), name = cột "Tên Dân Tộc".
 * - NATIONALITY_ITEMS: "Master_Data_Quoc_Tich_ISO3166.md" — code = cột "Mã ISO Alpha-3", name =
 *   cột "Tên Quốc Gia (Tiếng Việt)". Cột "Mã số Numeric" (704, 840...) trong file gốc KHÔNG được
 *   dùng — chưa có nhu cầu nghiệp vụ, bỏ có chủ đích (không phải bỏ sót).
 *
 * sortOrder khớp đúng thứ tự trong file gốc: dân tộc = chính mã số, quốc tịch = thứ tự dòng.
 */

export interface ReferenceCatalogSeedItem {
  code: string;
  name: string;
  sortOrder: number;
}

export const ETHNICITY_ITEMS: readonly ReferenceCatalogSeedItem[] = [
  { code: '1', name: 'Kinh', sortOrder: 1 },
  { code: '2', name: 'Tày', sortOrder: 2 },
  { code: '3', name: 'Thái', sortOrder: 3 },
  { code: '4', name: 'Mường', sortOrder: 4 },
  { code: '5', name: 'Khmer', sortOrder: 5 },
  { code: '6', name: 'Hoa', sortOrder: 6 },
  { code: '7', name: 'Nùng', sortOrder: 7 },
  { code: '8', name: "H'Mông", sortOrder: 8 },
  { code: '9', name: 'Dao', sortOrder: 9 },
  { code: '10', name: 'Gia Rai', sortOrder: 10 },
  { code: '11', name: 'Ê Đê', sortOrder: 11 },
  { code: '12', name: 'Ba Na', sortOrder: 12 },
  { code: '13', name: 'Sán Chay', sortOrder: 13 },
  { code: '14', name: 'Chăm', sortOrder: 14 },
  { code: '15', name: 'Kơ Ho', sortOrder: 15 },
  { code: '16', name: 'Xơ Đăng', sortOrder: 16 },
  { code: '17', name: 'Sán Dìu', sortOrder: 17 },
  { code: '18', name: 'Hrê', sortOrder: 18 },
  { code: '19', name: 'Ra Glai', sortOrder: 19 },
  { code: '20', name: "M'Nông", sortOrder: 20 },
  { code: '21', name: 'Stiêng', sortOrder: 21 },
  { code: '22', name: 'Bru - Vân Kiều', sortOrder: 22 },
  { code: '23', name: 'Thổ', sortOrder: 23 },
  { code: '24', name: 'Giáy', sortOrder: 24 },
  { code: '25', name: 'Cơ Tu', sortOrder: 25 },
  { code: '26', name: 'Gié - Triêng', sortOrder: 26 },
  { code: '27', name: 'Mạ', sortOrder: 27 },
  { code: '28', name: 'Tà Ôi', sortOrder: 28 },
  { code: '29', name: 'Chơ Ro', sortOrder: 29 },
  { code: '30', name: 'Khơ Mú', sortOrder: 30 },
  { code: '31', name: 'Xinh Mun', sortOrder: 31 },
  { code: '32', name: 'Hà Nhì', sortOrder: 32 },
  { code: '33', name: 'Chu Ru', sortOrder: 33 },
  { code: '34', name: 'Lao', sortOrder: 34 },
  { code: '35', name: 'La Chí', sortOrder: 35 },
  { code: '36', name: 'Phù Lá', sortOrder: 36 },
  { code: '37', name: 'La Ha', sortOrder: 37 },
  { code: '38', name: 'Pà Thẻn', sortOrder: 38 },
  { code: '39', name: 'Lô Lô', sortOrder: 39 },
  { code: '40', name: 'Chứt', sortOrder: 40 },
  { code: '41', name: 'Mảng', sortOrder: 41 },
  { code: '42', name: 'Cờ Lao', sortOrder: 42 },
  { code: '43', name: 'Bố Y', sortOrder: 43 },
  { code: '44', name: 'La Hủ', sortOrder: 44 },
  { code: '45', name: 'Cống', sortOrder: 45 },
  { code: '46', name: 'Ngái', sortOrder: 46 },
  { code: '47', name: 'Si La', sortOrder: 47 },
  { code: '48', name: 'Pu Péo', sortOrder: 48 },
  { code: '49', name: 'Brâu', sortOrder: 49 },
  { code: '50', name: 'Ơ Đu', sortOrder: 50 },
  { code: '51', name: 'Rơ Măm', sortOrder: 51 },
  { code: '52', name: 'Lự', sortOrder: 52 },
  { code: '53', name: 'Kháng', sortOrder: 53 },
  { code: '54', name: 'Co', sortOrder: 54 },
];

export const NATIONALITY_ITEMS: readonly ReferenceCatalogSeedItem[] = [
  { code: 'VNM', name: 'Việt Nam', sortOrder: 1 },
  { code: 'USA', name: 'Hoa Kỳ', sortOrder: 2 },
  { code: 'JPN', name: 'Nhật Bản', sortOrder: 3 },
  { code: 'KOR', name: 'Hàn Quốc', sortOrder: 4 },
  { code: 'CHN', name: 'Trung Quốc', sortOrder: 5 },
  { code: 'GBR', name: 'Vương quốc Anh', sortOrder: 6 },
  { code: 'FRA', name: 'Pháp', sortOrder: 7 },
  { code: 'DEU', name: 'Đức', sortOrder: 8 },
  { code: 'AUS', name: 'Úc', sortOrder: 9 },
  { code: 'CAN', name: 'Canada', sortOrder: 10 },
  { code: 'SGP', name: 'Singapore', sortOrder: 11 },
  { code: 'THA', name: 'Thái Lan', sortOrder: 12 },
  { code: 'MYS', name: 'Malaysia', sortOrder: 13 },
  { code: 'IDN', name: 'Indonesia', sortOrder: 14 },
  { code: 'PHL', name: 'Philippines', sortOrder: 15 },
  { code: 'IND', name: 'Ấn Độ', sortOrder: 16 },
  { code: 'RUS', name: 'Nga', sortOrder: 17 },
  { code: 'BRA', name: 'Brazil', sortOrder: 18 },
  { code: 'ITA', name: 'Ý', sortOrder: 19 },
  { code: 'ESP', name: 'Tây Ban Nha', sortOrder: 20 },
  { code: 'CHE', name: 'Thụy Sĩ', sortOrder: 21 },
  { code: 'NLD', name: 'Hà Lan', sortOrder: 22 },
  { code: 'SWE', name: 'Thụy Điển', sortOrder: 23 },
  { code: 'NZL', name: 'New Zealand', sortOrder: 24 },
  { code: 'TWN', name: 'Đài Loan', sortOrder: 25 },
  { code: 'HKG', name: 'Hồng Kông', sortOrder: 26 },
  { code: 'LAO', name: 'Lào', sortOrder: 27 },
  { code: 'KHM', name: 'Campuchia', sortOrder: 28 },
  { code: 'MMR', name: 'Myanmar', sortOrder: 29 },
  { code: 'ZAF', name: 'Nam Phi', sortOrder: 30 },
];
