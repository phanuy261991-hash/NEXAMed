import { DRUG_IMPORT_EXAMPLE_CODE_PREFIX } from '@nexamed/shared';

/**
 * Định nghĩa cột + dữ liệu ví dụ của file Excel "Thuốc & Vật tư" (docs/DECISIONS.md #210) — MỘT
 * nguồn dùng chung cho file mẫu, file xuất và bộ đọc (kiểm tiêu đề cột) nên 3 nơi không lệch nhau.
 *
 * Tiêu đề cột = nhãn + dấu hiệu: ` *` bắt buộc, ` *(thuốc)` bắt buộc khi Loại = Thuốc, ` (thuốc)` chỉ áp
 * cho Thuốc (tuỳ chọn), không dấu = tuỳ chọn. Nhãn KHÔNG được chứa `*` hay `(` — bộ đọc cắt từ ký tự
 * đó trở đi để lấy lại nhãn.
 */
export type ImportColumnRequirement = 'required' | 'medicineRequired' | 'medicineOnly' | 'optional';

export interface ImportColumn {
  key: string;
  label: string;
  requirement: ImportColumnRequirement;
  width: number;
  /** Hướng dẫn điền — hiện ở sheet "Hướng dẫn". */
  guide: string;
  /** Cột lưu dạng CHỮ (mã/số đăng ký/mã vạch) — định dạng ô `@` để Excel không nuốt số 0 đầu. */
  text?: boolean;
}

export const SHEET_ITEMS = 'Thuốc & Vật tư';
export const SHEET_INGREDIENTS = 'Hoạt chất';
export const SHEET_UNITS = 'Quy đổi đơn vị';
export const SHEET_GUIDE = 'Hướng dẫn';
export const SHEET_CATALOG = 'Danh mục hiện có';

const REQUIREMENT_MARK: Record<ImportColumnRequirement, string> = {
  required: ' *',
  medicineRequired: ' *(thuốc)',
  medicineOnly: ' (thuốc)',
  optional: '',
};

export function columnHeaderText(column: ImportColumn): string {
  return column.label + REQUIREMENT_MARK[column.requirement];
}

/** Lấy lại nhãn thuần từ ô tiêu đề (bỏ dấu hiệu bắt buộc/thuốc). */
export function headerLabelOf(headerText: string): string {
  return headerText.replace(/\s*[*(].*$/, '').trim();
}

export const ITEM_COLUMNS: ImportColumn[] = [
  { key: 'code', label: 'Mã', requirement: 'required', width: 16, text: true, guide: `Mã mặt hàng, DUY NHẤT trong phòng khám. Mã đã có trong hệ thống sẽ bị bỏ qua (không ghi đè). KHÔNG đặt mã bắt đầu bằng "${DRUG_IMPORT_EXAMPLE_CODE_PREFIX}" — dòng đó được coi là dòng ví dụ và bị bỏ qua.` },
  { key: 'name', label: 'Tên', requirement: 'required', width: 30, guide: 'Tên mặt hàng, ví dụ "Paracetamol 500mg".' },
  { key: 'itemType', label: 'Loại', requirement: 'required', width: 10, guide: 'Chọn Thuốc hoặc Vật tư.' },
  { key: 'baseUnit', label: 'Đơn vị cơ sở', requirement: 'required', width: 14, guide: 'Đơn vị NHỎ NHẤT dùng để kê đơn/xuất kho (Viên, Ống, Cái...). Gõ TÊN đơn vị; chưa có trong danh mục thì tự tạo mới.' },
  { key: 'price', label: 'Giá bán', requirement: 'required', width: 12, guide: 'Giá bán trên 1 đơn vị cơ sở, số nguyên, đơn vị đồng (VNĐ), ví dụ 1500.' },
  { key: 'manufacturer', label: 'Hãng sản xuất', requirement: 'required', width: 26, guide: 'Hãng/nhà sản xuất. Gõ TÊN; chưa có trong danh mục thì tự tạo mới.' },
  { key: 'isBatchManaged', label: 'Quản lý theo lô', requirement: 'optional', width: 14, guide: 'Có = quản lý lô và hạn dùng (mặc định khi để trống); Không = không theo lô.' },
  { key: 'drugGroup', label: 'Nhóm thuốc', requirement: 'medicineRequired', width: 22, guide: 'Nhóm thuốc/nhóm tác dụng dược lý (Kháng sinh, Giảm đau - hạ sốt...). Gõ TÊN; chưa có thì tự tạo mới.' },
  { key: 'route', label: 'Đường dùng', requirement: 'medicineRequired', width: 14, guide: 'Đường dùng (Uống, Tiêm, Bôi ngoài da...). Gõ TÊN; chưa có thì tự tạo mới.' },
  { key: 'registrationNumber', label: 'Số đăng ký', requirement: 'medicineRequired', width: 16, text: true, guide: 'Số đăng ký lưu hành ghi trên bao bì thuốc.' },
  { key: 'dosageForm', label: 'Dạng bào chế', requirement: 'medicineRequired', width: 18, guide: 'Dạng bào chế (Viên nén, Viên nang, Dung dịch tiêm...). Gõ TÊN; chưa có thì tự tạo mới.' },
  { key: 'country', label: 'Nước sản xuất', requirement: 'medicineRequired', width: 16, guide: 'Nước sản xuất (Việt Nam, Pháp...). Gõ TÊN; chưa có thì tự tạo mới.' },
  { key: 'controlType', label: 'Phân loại kiểm soát', requirement: 'medicineOnly', width: 18, guide: 'Thường (mặc định khi để trống) / Độc / Gây nghiện / Hướng thần / Tiền chất.' },
  { key: 'isPrescriptionOnly', label: 'Chỉ bán theo đơn', requirement: 'medicineOnly', width: 16, guide: 'Có = thuốc kê đơn (mặc định khi để trống); Không = thuốc không kê đơn (OTC).' },
  { key: 'nationalCode', label: 'Mã BYT', requirement: 'optional', width: 14, text: true, guide: 'Mã thuốc quốc gia/mã Bộ Y tế, nếu có.' },
  { key: 'barcode', label: 'Mã vạch', requirement: 'medicineOnly', width: 16, text: true, guide: 'Mã vạch in trên bao bì (chỉ lưu cho Thuốc).' },
  { key: 'shortcutCode', label: 'Gõ tắt', requirement: 'optional', width: 10, text: true, guide: 'Mã gõ tắt để bác sĩ tìm nhanh lúc kê đơn (ví dụ "ptm"), tối đa 20 ký tự, không trùng mặt hàng khác.' },
  { key: 'packagingSpec', label: 'Quy cách đóng gói', requirement: 'optional', width: 26, guide: 'Ghi chú quy cách đóng gói, ví dụ "Hộp 10 vỉ x 10 viên".' },
  { key: 'storageCondition', label: 'Điều kiện bảo quản', requirement: 'medicineOnly', width: 22, guide: 'Điều kiện bảo quản. Gõ TÊN; chưa có thì tự tạo mới.' },
  { key: 'storageLocation', label: 'Vị trí bảo quản', requirement: 'medicineOnly', width: 18, guide: 'Vị trí cất giữ trong kho (kệ/tủ). Gõ TÊN; chưa có thì tự tạo mới.' },
  { key: 'defaultDosage', label: 'Liều dùng mặc định', requirement: 'medicineOnly', width: 22, guide: 'Liều dùng gợi ý, ví dụ "1-2 viên/lần".' },
  { key: 'usageInstruction', label: 'Cách dùng', requirement: 'medicineOnly', width: 28, guide: 'Hướng dẫn cách dùng, ví dụ "Uống sau ăn".' },
  { key: 'contraindications', label: 'Chống chỉ định', requirement: 'medicineOnly', width: 24, guide: 'Chống chỉ định chính (văn bản tự do).' },
  { key: 'minStockAlert', label: 'Tồn tối thiểu', requirement: 'optional', width: 13, guide: 'Ngưỡng cảnh báo tồn thấp (theo đơn vị cơ sở), số nguyên.' },
  { key: 'maxStockAlert', label: 'Tồn tối đa', requirement: 'optional', width: 12, guide: 'Ngưỡng cảnh báo tồn cao (theo đơn vị cơ sở), số nguyên.' },
];

export const INGREDIENT_COLUMNS: ImportColumn[] = [
  { key: 'code', label: 'Mã thuốc', requirement: 'required', width: 16, text: true, guide: 'Mã của thuốc ở sheet "Thuốc & Vật tư". 1 thuốc có nhiều hoạt chất thì ghi nhiều dòng cùng mã.' },
  { key: 'ingredient', label: 'Hoạt chất', requirement: 'required', width: 26, guide: 'Tên hoạt chất. Chưa có trong danh mục thì tự tạo mới.' },
  { key: 'strength', label: 'Hàm lượng', requirement: 'required', width: 12, guide: 'Số, dùng dấu phẩy hoặc chấm làm dấu thập phân (tối đa 3 chữ số lẻ), ví dụ 500 hoặc 62,5.' },
  { key: 'strengthUnit', label: 'Đơn vị hàm lượng', requirement: 'required', width: 16, guide: 'Đơn vị của hàm lượng (mg, g, ml, IU...). Chưa có trong danh mục thì tự tạo mới.' },
];

export const UNIT_COLUMNS: ImportColumn[] = [
  { key: 'code', label: 'Mã thuốc', requirement: 'required', width: 16, text: true, guide: 'Mã của mặt hàng ở sheet "Thuốc & Vật tư". Mặt hàng không đổi đơn vị thì không cần dòng nào ở sheet này.' },
  { key: 'unit', label: 'Đơn vị lớn hơn', requirement: 'required', width: 16, guide: 'Một đơn vị lớn hơn đơn vị cơ sở (Vỉ, Hộp, Thùng...). Xếp các dòng của cùng 1 mã từ NHỎ đến LỚN: dòng 1 là bậc ngay trên đơn vị cơ sở.' },
  { key: 'factor', label: 'Quy đổi ra đơn vị ngay bên dưới', requirement: 'required', width: 20, guide: '1 đơn vị ở cột bên trái = BAO NHIÊU đơn vị ngay bên dưới nó (dòng 1: bao nhiêu đơn vị cơ sở). Số nguyên dương.' },
  { key: 'price', label: 'Giá bán', requirement: 'optional', width: 12, guide: 'Giá bán riêng của đơn vị này (đồng). Điền cho TẤT CẢ các bậc của cùng 1 mã thì hệ thống tự bật "Giá theo từng đơn vị"; để trống hết thì giá suy theo tỷ lệ quy đổi.' },
];

export type ImportRecord = Record<string, string | number>;

/**
 * Dữ liệu ví dụ trong file mẫu (3 mặt hàng) — mã bắt đầu bằng `VD-` nên bị bỏ qua khi nhập. Tên
 * Đơn vị/Hãng/Nhóm... là tên PHỔ BIẾN; tên chưa có trong danh mục của phòng khám chỉ có tác dụng minh hoạ.
 */
export const ITEM_EXAMPLES: ImportRecord[] = [
  {
    code: 'VD-THUOC-01', name: 'Paracetamol 500mg', itemType: 'Thuốc', baseUnit: 'Viên', price: 1500, manufacturer: 'Công ty CP Dược Hậu Giang',
    isBatchManaged: 'Có', drugGroup: 'Giảm đau, hạ sốt', route: 'Uống', registrationNumber: 'VD-12345-20', dosageForm: 'Viên nén', country: 'Việt Nam',
    controlType: 'Thường', isPrescriptionOnly: 'Không', nationalCode: '', barcode: '8934567890123', shortcutCode: 'ptm', packagingSpec: 'Hộp 10 vỉ x 10 viên',
    storageCondition: 'Nơi khô ráo, dưới 30°C', storageLocation: 'Tủ A - Ngăn 1', defaultDosage: '1-2 viên/lần', usageInstruction: 'Uống sau ăn, cách nhau 4-6 giờ',
    contraindications: 'Suy gan nặng', minStockAlert: 100, maxStockAlert: 2000,
  },
  {
    code: 'VD-THUOC-02', name: 'Amoxicillin + Acid clavulanic 625mg', itemType: 'Thuốc', baseUnit: 'Viên', price: 18000, manufacturer: 'GlaxoSmithKline',
    isBatchManaged: 'Có', drugGroup: 'Kháng sinh', route: 'Uống', registrationNumber: 'VN-12345-18', dosageForm: 'Viên bao phim', country: 'Anh',
    controlType: 'Thường', isPrescriptionOnly: 'Có', nationalCode: '', barcode: '8935432109876', shortcutCode: 'aug', packagingSpec: 'Hộp 2 vỉ x 7 viên',
    storageCondition: 'Nơi khô ráo, dưới 25°C', storageLocation: 'Tủ B - Ngăn 2', defaultDosage: '1 viên/lần, 2 lần/ngày', usageInstruction: 'Uống đầu bữa ăn',
    contraindications: 'Tiền sử dị ứng nhóm penicillin', minStockAlert: 50, maxStockAlert: 500,
  },
  {
    code: 'VD-VATTU-01', name: 'Bơm tiêm nhựa 5ml', itemType: 'Vật tư', baseUnit: 'Cái', price: 1200, manufacturer: 'Công ty TNHH Vật tư Y tế ABC',
    isBatchManaged: 'Có', packagingSpec: 'Hộp 100 cái', minStockAlert: 200, maxStockAlert: 3000,
  },
];

export const INGREDIENT_EXAMPLES: ImportRecord[] = [
  { code: 'VD-THUOC-01', ingredient: 'Paracetamol', strength: 500, strengthUnit: 'mg' },
  { code: 'VD-THUOC-02', ingredient: 'Amoxicillin', strength: 500, strengthUnit: 'mg' },
  { code: 'VD-THUOC-02', ingredient: 'Acid clavulanic', strength: 125, strengthUnit: 'mg' },
];

export const UNIT_EXAMPLES: ImportRecord[] = [
  // Dòng 1 = bậc ngay trên đơn vị cơ sở (1 Vỉ = 7 Viên), dòng 2 = bậc kế tiếp (1 Hộp = 2 Vỉ) — xếp từ NHỎ đến LỚN.
  { code: 'VD-THUOC-02', unit: 'Vỉ', factor: 7, price: 126000 },
  { code: 'VD-THUOC-02', unit: 'Hộp', factor: 2, price: 252000 },
  // Vật tư: giá để trống → hệ thống suy giá bậc theo tỷ lệ quy đổi.
  { code: 'VD-VATTU-01', unit: 'Hộp', factor: 100, price: '' },
];
