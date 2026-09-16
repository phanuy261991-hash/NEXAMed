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
 * - OCCUPATION_ITEMS: "docs/data/nghe-nghiep.md" (13 dòng) — code = cột "Mã (Code)", name = cột
 *   "Tên nghề nghiệp".
 * - DRUG_GROUP_ITEMS/DRUG_ROUTE_ITEMS/DOSAGE_FORM_ITEMS (docs/DECISIONS.md #152) —
 *   "docs/data/nhom-tac-dung-duoc-ly.md"/"duong-dung-thuoc.md"/"dang-bao-che.md" — nạp ĐẦY ĐỦ mọi
 *   cột có trong file gốc (chủ dự án yêu cầu trực tiếp, không bỏ bớt cột nào): code = cột "Mã UI"
 *   (ngắn, dùng làm khoá), name = cột "Tên ngắn UI" (hiện trong Combobox lúc kê đơn/nhập thuốc),
 *   fullName = cột "Tên đầy đủ chuẩn" (văn bản chuẩn ngành, không dùng làm `name` vì quá dài cho
 *   dropdown), bytCode = cột "Mã Bộ Y tế" (chuẩn liên thông BHYT, Quyết định 130/QĐ-BYT — CHỈ lưu
 *   để chuẩn bị, chưa dùng ở đâu vì BHYT ngoài phạm vi v1), description = cột "Mô tả/Ví dụ" hoặc
 *   "Mô tả/Phân loại" (CHỈ có ở duong-dung-thuoc.md/dang-bao-che.md — nhom-tac-dung-duoc-ly.md
 *   không có cột này, DRUG_GROUP_ITEMS không set description).
 *
 * sortOrder khớp đúng thứ tự trong file gốc: dân tộc = chính mã số, quốc tịch/nghề nghiệp/nhóm
 * thuốc/đường dùng/dạng bào chế = thứ tự dòng.
 */

export interface ReferenceCatalogSeedItem {
  code: string;
  name: string;
  sortOrder: number;
  /** Chỉ có ý nghĩa với EMPLOYMENT_STATUS_ITEMS — xem comment cột `deactivatesAccount` ở schema.prisma. */
  deactivatesAccount?: boolean;
  /** Chỉ có ý nghĩa với DRUG_GROUP_ITEMS/DRUG_ROUTE_ITEMS/DOSAGE_FORM_ITEMS — xem comment cột
   * `bytCode` ở schema.prisma (docs/DECISIONS.md #152). */
  bytCode?: string;
  /** Chỉ có ý nghĩa với DRUG_GROUP_ITEMS/DRUG_ROUTE_ITEMS/DOSAGE_FORM_ITEMS — xem comment cột
   * `fullName` ở schema.prisma (docs/DECISIONS.md #152). */
  fullName?: string;
  /** Tái dùng cột `description` có sẵn (UNIT_SEED_ITEMS đã dùng cột này riêng, xem `unit-seed-
   * data.ts`) — với DRUG_ROUTE_ITEMS/DOSAGE_FORM_ITEMS đây là cột "Mô tả/Ví dụ" của file gốc. */
  description?: string;
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

/**
 * Danh mục quản lý tài khoản nhân sự (mở rộng ADM-01) — giá trị mặc định chủ dự án cho sẵn.
 * Khác ETHNICITY/NATIONALITY (nguồn dữ liệu chính thức bên ngoài), 2 danh sách này chỉ là điểm
 * khởi đầu hợp lý — clinic_admin thêm/sửa/ẩn được qua UI như mọi category khác.
 */
export const EMPLOYMENT_STATUS_ITEMS: readonly ReferenceCatalogSeedItem[] = [
  { code: 'ACTIVE', name: 'Đang làm', sortOrder: 1, deactivatesAccount: false },
  { code: 'ON_LEAVE', name: 'Tạm nghỉ', sortOrder: 2, deactivatesAccount: false },
  { code: 'RESIGNED', name: 'Nghỉ việc', sortOrder: 3, deactivatesAccount: true },
];

export const EMPLOYMENT_TYPE_ITEMS: readonly ReferenceCatalogSeedItem[] = [
  { code: 'FULL_TIME', name: 'Chính thức', sortOrder: 1 },
  { code: 'COLLABORATOR', name: 'Cộng tác viên', sortOrder: 2 },
  { code: 'INTERN', name: 'Thực tập', sortOrder: 3 },
  { code: 'PROBATION', name: 'Thử việc', sortOrder: 4 },
];

/**
 * Danh mục "Nghề nghiệp" (đảo ngược tiếp #034/#061) — chủ dự án cung cấp `docs/data/nghe-nghiep.md`
 * kèm mã chính thức (khác ETHNICITY/NATIONALITY về nguồn nhưng CÙNG cách seed: giữ nguyên `code`
 * cho trước, không tự sinh mã ngắn tuần tự #113 — category này KHÔNG có trong
 * `REFERENCE_CATALOG_SHORT_CODE_PREFIXES`). Thứ tự khớp đúng thứ tự dòng trong file gốc.
 */
export const OCCUPATION_ITEMS: readonly ReferenceCatalogSeedItem[] = [
  { code: 'CCVC', name: 'Cán bộ, công chức, viên chức', sortOrder: 1 },
  { code: 'NV_VP', name: 'Nhân viên văn phòng', sortOrder: 2 },
  { code: 'KINH_DOANH', name: 'Kinh doanh / Buôn bán', sortOrder: 3 },
  { code: 'CONG_NHAN', name: 'Công nhân', sortOrder: 4 },
  { code: 'NONG_DAN', name: 'Nông dân', sortOrder: 5 },
  { code: 'HSSV', name: 'Học sinh / Sinh viên', sortOrder: 6 },
  { code: 'LLVT', name: 'Lực lượng vũ trang (Quân đội, Công an)', sortOrder: 7 },
  { code: 'TRE_EM', name: 'Trẻ em (Dưới 6 tuổi)', sortOrder: 8 },
  { code: 'HUU_TRI', name: 'Hưu trí', sortOrder: 9 },
  { code: 'LDTD', name: 'Lao động tự do', sortOrder: 10 },
  { code: 'NOI_TRO', name: 'Nội trợ', sortOrder: 11 },
  { code: 'THAT_NGHIEP', name: 'Không có việc làm / Thất nghiệp', sortOrder: 12 },
  { code: 'KHAC', name: 'Khác', sortOrder: 13 },
];

/**
 * "Nhóm tác dụng dược lý" (`DRUG_GROUP`, Kho Thuốc GĐ1, docs/DECISIONS.md #152) — chủ dự án cung
 * cấp `docs/data/nhom-tac-dung-duoc-ly.md`, chuẩn hoá theo danh mục dùng chung của Bộ Y tế. Thứ tự
 * khớp đúng thứ tự dòng trong file gốc, "Khác" (N99) đứng cuối.
 */
export const DRUG_GROUP_ITEMS: readonly ReferenceCatalogSeedItem[] = [
  { code: 'N01', bytCode: '1', name: 'Kháng sinh - Kháng khuẩn', fullName: 'Thuốc chống nhiễm khuẩn', sortOrder: 1 },
  { code: 'N02', bytCode: '2', name: 'Giảm đau - Hạ sốt - NSAID', fullName: 'Thuốc giảm đau, hạ sốt, chống viêm phi Steroid (NSAID)', sortOrder: 2 },
  { code: 'N03', bytCode: '3', name: 'Cơ - Xương - Khớp & Gút', fullName: 'Thuốc điều trị Gút và các bệnh xương khớp', sortOrder: 3 },
  { code: 'N04', bytCode: '4', name: 'Chống dị ứng', fullName: 'Thuốc chống dị ứng và các trường hợp tăng cảm ứng', sortOrder: 4 },
  { code: 'N05', bytCode: '5', name: 'Thần kinh trung ương', fullName: 'Thuốc tác dụng trên hệ thần kinh trung ương', sortOrder: 5 },
  { code: 'N06', bytCode: '6', name: 'Điều trị Parkinson', fullName: 'Thuốc điều trị bệnh Parkinson', sortOrder: 6 },
  { code: 'N07', bytCode: '7', name: 'Hô hấp', fullName: 'Thuốc tác dụng trên đường hô hấp', sortOrder: 7 },
  { code: 'N08', bytCode: '8', name: 'Tim mạch', fullName: 'Thuốc tác dụng trên hệ tim mạch', sortOrder: 8 },
  { code: 'N09', bytCode: '9', name: 'Tiêu hóa', fullName: 'Thuốc tác dụng trên hệ tiêu hóa', sortOrder: 9 },
  { code: 'N10', bytCode: '10', name: 'Nội tiết - Tiểu đường', fullName: 'Thuốc điều trị bệnh nội tiết, chuyển hóa', sortOrder: 10 },
  { code: 'N11', bytCode: '11', name: 'Máu & Cơ quan tạo máu', fullName: 'Thuốc điều trị máu và cơ quan tạo máu', sortOrder: 11 },
  { code: 'N12', bytCode: '12', name: 'Mắt - Tai Mũi Họng', fullName: 'Thuốc dùng cho mắt, tai - mũi - họng', sortOrder: 12 },
  { code: 'N13', bytCode: '13', name: 'Da liễu - Dùng ngoài', fullName: 'Thuốc dùng ngoài da', sortOrder: 13 },
  { code: 'N14', bytCode: '14', name: 'Dịch truyền & Điện giải', fullName: 'Dung dịch điều chỉnh nước, điện giải và cân bằng Acid-Base', sortOrder: 14 },
  { code: 'N15', bytCode: '15', name: 'Vitamin & Khoáng chất', fullName: 'Vitamin và Khoáng chất', sortOrder: 15 },
  { code: 'N16', bytCode: '16', name: 'Tiết niệu - Sinh dục', fullName: 'Thuốc tác dụng trên hệ tiết niệu và sinh dục', sortOrder: 16 },
  { code: 'N17', bytCode: '17', name: 'Sát khuẩn - Tẩy uế', fullName: 'Thuốc sát khuẩn, tẩy uế', sortOrder: 17 },
  { code: 'N18', bytCode: '18', name: 'Cấp cứu & Chống độc', fullName: 'Thuốc cấp cứu và chống độc', sortOrder: 18 },
  { code: 'N19', bytCode: '19', name: 'Ung thư & Miễn dịch', fullName: 'Thuốc điều trị ung thư và điều hòa miễn dịch', sortOrder: 19 },
  { code: 'N20', bytCode: '20', name: 'Vaccine & Sinh học', fullName: 'Thuốc tác dụng trên hệ miễn dịch / Bào chế sinh học', sortOrder: 20 },
  { code: 'N21', bytCode: '21', name: 'Đông y - Dược liệu', fullName: 'Thuốc y học cổ truyền / Dược liệu', sortOrder: 21 },
  { code: 'N22', bytCode: '22', name: 'Thực phẩm chức năng', fullName: 'Thực phẩm bảo vệ sức khoẻ / Thực phẩm chức năng', sortOrder: 22 },
  { code: 'N23', bytCode: '23', name: 'Thuốc cản quang - Chẩn đoán', fullName: 'Thuốc chẩn đoán, thuốc cản quang', sortOrder: 23 },
  { code: 'N24', bytCode: '24', name: 'Máu & Chế phẩm máu', fullName: 'Máu, các sản phẩm từ máu và dung dịch thay thế huyết tương', sortOrder: 24 },
  { code: 'N25', bytCode: '25', name: 'Hormon - Nội tiết tố', fullName: 'Hormon và các chế phẩm tổng hợp có tác dụng tương tự', sortOrder: 25 },
  { code: 'N26', bytCode: '26', name: 'Gây mê - Gây tê', fullName: 'Thuốc gây mê, gây tê', sortOrder: 26 },
  { code: 'N27', bytCode: '27', name: 'Giãn cơ', fullName: 'Thuốc giãn cơ và tăng trương lực cơ', sortOrder: 27 },
  { code: 'N99', bytCode: '99', name: 'Khác', fullName: 'Nhóm thuốc khác', sortOrder: 28 },
];

/**
 * "Đường dùng thuốc" (`DRUG_ROUTE`, Kho Thuốc GĐ1, docs/DECISIONS.md #152) — chủ dự án cung cấp
 * `docs/data/duong-dung-thuoc.md`, chuẩn hoá theo mã liên thông BHYT (Quyết định 130/QĐ-BYT).
 */
export const DRUG_ROUTE_ITEMS: readonly ReferenceCatalogSeedItem[] = [
  { code: 'U01', bytCode: '1', name: 'Uống', fullName: 'Đường uống', description: 'Viên nén, viên nang, siro, cốm uống', sortOrder: 1 },
  { code: 'U02', bytCode: '2.01', name: 'Tiêm IV', fullName: 'Tiêm tĩnh mạch', description: 'Tiêm trực tiếp tĩnh mạch', sortOrder: 2 },
  { code: 'U03', bytCode: '2.02', name: 'Tiêm IM', fullName: 'Tiêm bắp', description: 'Tiêm cơ bắp (mông, đùi, delta)', sortOrder: 3 },
  { code: 'U04', bytCode: '2.03', name: 'Tiêm SC', fullName: 'Tiêm dưới da', description: 'Tiêm mô mỡ dưới da (Insulin, vắc xin...)', sortOrder: 4 },
  { code: 'U05', bytCode: '2.04', name: 'Truyền tĩnh mạch', fullName: 'Truyền tĩnh mạch', description: 'Dịch truyền thể tích lớn', sortOrder: 5 },
  { code: 'U06', bytCode: '2.05', name: 'Tiêm ID', fullName: 'Tiêm trong da', description: 'Tiêm thử phản ứng (test da), BCG', sortOrder: 6 },
  { code: 'U07', bytCode: '3.01', name: 'Nhỏ mắt', fullName: 'Dùng cho mắt', description: 'Thuốc nhỏ mắt, mỡ tra mắt', sortOrder: 7 },
  { code: 'U08', bytCode: '3.02', name: 'Nhỏ tai', fullName: 'Dùng cho tai', description: 'Dung dịch nhỏ tai, rửa tai', sortOrder: 8 },
  { code: 'U09', bytCode: '3.03', name: 'Xịt / Nhỏ mũi', fullName: 'Dùng cho mũi', description: 'Thuốc nhỏ mũi, xịt mũi', sortOrder: 9 },
  { code: 'U10', bytCode: '4.01', name: 'Đặt hậu môn', fullName: 'Đường hậu môn / Trực tràng', description: 'Viên đạn đặt hậu môn, thuốc thụt', sortOrder: 10 },
  { code: 'U11', bytCode: '4.02', name: 'Đặt âm đạo', fullName: 'Đường âm đạo', description: 'Viên đặt phụ khoa, gel âm đạo', sortOrder: 11 },
  { code: 'U12', bytCode: '5.01', name: 'Hít / Khí dung', fullName: 'Đường hô hấp (Hít / Khí dung)', description: 'Bình xịt định liều, khí dung phế quản', sortOrder: 12 },
  { code: 'U13', bytCode: '6.01', name: 'Dùng ngoài / Bôi', fullName: 'Dùng ngoài da', description: 'Kem, gel, thuốc mỡ bôi ngoài', sortOrder: 13 },
  { code: 'U14', bytCode: '6.02', name: 'Dán ngoài da', fullName: 'Miếng dán qua da', description: 'Miếng dán thẩm thấu qua da', sortOrder: 14 },
  { code: 'U15', bytCode: '1.02', name: 'Ngậm / Đặt dưới lưỡi', fullName: 'Ngậm / Đặt dưới lưỡi', description: 'Viên ngậm, viên tan dưới lưỡi', sortOrder: 15 },
  { code: 'U16', bytCode: '2.06', name: 'Tiêm khớp', fullName: 'Tiêm vào khớp / Ổ khớp', description: 'Tiêm nội khớp, dịch khớp', sortOrder: 16 },
  { code: 'U17', bytCode: '7.01', name: 'Rửa / Nhỏ niệu đạo', fullName: 'Dùng qua đường tiết niệu', description: 'Bơm rửa bàng quang, niệu đạo', sortOrder: 17 },
  { code: 'U99', bytCode: '9', name: 'Khác', fullName: 'Đường dùng khác', description: 'Các đường dùng đặc thù khác', sortOrder: 18 },
];

/**
 * "Dạng bào chế" (`DOSAGE_FORM`, Kho Thuốc #151, docs/DECISIONS.md #152) — chủ dự án cung cấp
 * `docs/data/dang-bao-che.md`. Category này ban đầu (#151) không seed cứng (mã tự sinh) vì lúc đó
 * chưa có nguồn dữ liệu chính thức — nay seed sẵn, vẫn quản lý thêm/sửa/ẩn được qua UI như
 * DRUG_GROUP/DRUG_ROUTE.
 */
export const DOSAGE_FORM_ITEMS: readonly ReferenceCatalogSeedItem[] = [
  { code: 'F01', bytCode: 'VN', name: 'Viên nén', fullName: 'Viên nén', description: 'Viên nén bao phim, bao đường, nén trần', sortOrder: 1 },
  { code: 'F02', bytCode: 'NC', name: 'Viên nang', fullName: 'Viên nang (Capsule)', description: 'Viên nang cứng, viên nang mềm', sortOrder: 2 },
  { code: 'F03', bytCode: 'NG', name: 'Viên ngậm', fullName: 'Viên ngậm / Viên ngậm dưới lưỡi', description: 'Viên ngậm ho, ngậm dưới lưỡi', sortOrder: 3 },
  { code: 'F04', bytCode: 'SU', name: 'Viên sủi', fullName: 'Viên nén sủi / Cốm sủi', description: 'Dạng sủi hòa tan vào nước', sortOrder: 4 },
  { code: 'F05', bytCode: 'VD', name: 'Viên đặt', fullName: 'Viên đặt (Hậu môn / Âm đạo)', description: 'Viên đạn trực tràng, viên trứng âm đạo', sortOrder: 5 },
  { code: 'F06', bytCode: 'CB', name: 'Cốm / Bột', fullName: 'Bột / Cốm pha uống', description: 'Bột pha uống, cốm pha hỗn dịch', sortOrder: 6 },
  { code: 'F07', bytCode: 'SR', name: 'Siro', fullName: 'Siro', description: 'Siro uống', sortOrder: 7 },
  { code: 'F08', bytCode: 'DD', name: 'Dung dịch uống', fullName: 'Dung dịch uống / Hỗn dịch uống', description: 'Dung dịch, hỗn dịch, nhũ dịch đường uống', sortOrder: 8 },
  { code: 'F09', bytCode: 'DT', name: 'Dung dịch tiêm', fullName: 'Dung dịch tiêm / Bột pha tiêm', description: 'Thuốc tiêm ống, lọ, bột đông khô tiêm', sortOrder: 9 },
  { code: 'F10', bytCode: 'TT', name: 'Dịch truyền', fullName: 'Dung dịch truyền tĩnh mạch', description: 'Chai/túi dịch truyền thể tích lớn', sortOrder: 10 },
  { code: 'F11', bytCode: 'NM', name: 'Dung dịch nhỏ mắt/mũi', fullName: 'Dung dịch nhỏ mắt / nhỏ mũi / nhỏ tai', description: 'Thuốc nhỏ mắt, tra mắt, nhỏ tai, nhỏ mũi', sortOrder: 11 },
  { code: 'F12', bytCode: 'KM', name: 'Thuốc kem / Gel', fullName: 'Kem / Gel / Thuốc mỡ bôi ngoài', description: 'Kem, gel, mỡ bôi da hoặc niêm mạc', sortOrder: 12 },
  { code: 'F13', bytCode: 'KD', name: 'Dung dịch xịt / Khí dung', fullName: 'Dung dịch xịt / Dung dịch khí dung', description: 'Xịt họng, xịt mũi, dung dịch khí dung', sortOrder: 13 },
  { code: 'F14', bytCode: 'MD', name: 'Miếng dán', fullName: 'Miếng dán qua da', description: 'Miếng dán thấm qua da', sortOrder: 14 },
  { code: 'F15', bytCode: 'CT', name: 'Cao / Trà dược liệu', fullName: 'Cao thuốc / Trà nhúng dược liệu', description: 'Cao lỏng, cao đặc, trà túi lọc dược liệu', sortOrder: 15 },
  { code: 'F99', bytCode: 'KH', name: 'Khác', fullName: 'Dạng bào chế khác', description: 'Các dạng bào chế đặc biệt khác', sortOrder: 16 },
];
