import { TECHNICAL_SERVICE_IMPORT_EXAMPLE_PREFIX } from '@nexamed/shared';
import type { ImportColumnBase, ImportRecord } from '../../common/excel-import/excel-import';

/**
 * Định nghĩa cột + dữ liệu ví dụ của file Excel "Dịch vụ kỹ thuật" (docs/DECISIONS.md #276) — MỘT nguồn dùng chung cho file mẫu, file xuất và bộ đọc (kiểm
 * tiêu đề cột) nên 3 nơi không lệch nhau. Tiêu đề cột = nhãn + dấu hiệu: ` *` bắt buộc, ` *(tại phòng khám)` bắt buộc khi "Làm tại phòng khám" = Có,
 * ` (xét nghiệm)` chỉ áp cho xét nghiệm, ` (ghi chú)` chỉ là gợi ý. Nhãn KHÔNG được chứa `*` hay `(` — bộ đọc cắt từ ký tự đó trở đi để lấy lại nhãn.
 */
export type ServiceColumnRequirement = 'required' | 'inHouseRequired' | 'labOnly' | 'optional';

export interface ServiceImportColumn extends ImportColumnBase {
  requirement: ServiceColumnRequirement;
  /** Ghi chú ngắn hiện trong ngoặc ở tiêu đề (ví dụ đơn vị "phút") — chỉ cho cột `optional`. */
  note?: string;
}

export const SHEET_SERVICES = 'Dịch vụ kỹ thuật';
export const SHEET_GUIDE = 'Hướng dẫn';
export const SHEET_CATALOG = 'Danh mục hiện có';

/** Tên cột dùng trong thông báo lỗi dòng — luôn lấy từ `label` để thông báo và tiêu đề file không lệch nhau. */
export const COLUMN = {
  kind: 'Loại',
  name: 'Tên',
  shortName: 'Tên viết tắt',
  nationalCode: 'Mã BYT',
  category: 'Nhóm dịch vụ',
  specimen: 'Loại mẫu',
  inHouse: 'Làm tại phòng khám',
  department: 'Khoa/Phòng thực hiện',
  turnaround: 'Thời gian trả kết quả',
  resultType: 'Kiểu kết quả',
  unit: 'Đơn vị tính',
  price: 'Giá bán',
} as const;

const REQUIREMENT_MARK: Record<ServiceColumnRequirement, string> = {
  required: ' *',
  inHouseRequired: ' *(tại phòng khám)',
  labOnly: ' (xét nghiệm)',
  optional: '',
};

export function serviceColumnHeaderText(column: ServiceImportColumn): string {
  return column.label + (column.note ? ` (${column.note})` : REQUIREMENT_MARK[column.requirement]);
}

export const SERVICE_COLUMNS: ServiceImportColumn[] = [
  { key: 'kind', label: COLUMN.kind, requirement: 'required', width: 20, guide: 'Chọn Xét nghiệm, Chẩn đoán hình ảnh hoặc Thăm dò chức năng. Mã dịch vụ do hệ thống tự cấp theo loại (XN/CD/TD), file không có cột Mã.' },
  {
    key: 'name',
    label: COLUMN.name,
    requirement: 'required',
    width: 36,
    guide: `Tên dịch vụ, tối đa 200 ký tự, ví dụ "Công thức máu". Dịch vụ cùng Loại + cùng Tên (không phân biệt hoa/thường/dấu) đã có trong hệ thống sẽ bị bỏ qua, không ghi đè. KHÔNG đặt tên bắt đầu bằng "${TECHNICAL_SERVICE_IMPORT_EXAMPLE_PREFIX}" — dòng đó được coi là dòng ví dụ và bị bỏ qua.`,
  },
  { key: 'shortName', label: COLUMN.shortName, requirement: 'optional', width: 18, guide: 'Tên gọi tắt hiện ở danh sách/phiếu, tối đa 100 ký tự.' },
  { key: 'nationalCode', label: COLUMN.nationalCode, requirement: 'optional', width: 14, text: true, guide: 'Mã dịch vụ kỹ thuật theo Bộ Y tế, nếu có (tối đa 50 ký tự).' },
  { key: 'category', label: COLUMN.category, requirement: 'optional', width: 22, guide: 'Nhóm dịch vụ (Huyết học, Sinh hoá, Siêu âm...). Gõ TÊN; chưa có trong danh mục thì tự tạo mới (chưa có viết tắt tem — bổ sung ở Danh mục dùng chung).' },
  { key: 'specimen', label: COLUMN.specimen, requirement: 'labOnly', width: 22, guide: 'Loại mẫu bệnh phẩm (Máu, Nước tiểu...). CHỈ dùng cho Xét nghiệm — loại khác phải để trống. Gõ TÊN; chưa có thì tự tạo mới (chưa có màu nắp ống — bổ sung ở Danh mục dùng chung).' },
  { key: 'inHouse', label: COLUMN.inHouse, requirement: 'optional', width: 18, guide: 'Có = phòng khám tự làm (mặc định khi để trống, bắt buộc có Giá bán); Không = chỉ chỉ định cho bệnh nhân làm ở nơi khác (không có giá).' },
  { key: 'department', label: COLUMN.department, requirement: 'optional', width: 24, guide: 'Khoa/Phòng thực hiện. Gõ ĐÚNG TÊN khoa/phòng đã có (xem sheet "Danh mục hiện có") — khoa/phòng KHÔNG được tự tạo mới từ file này.' },
  { key: 'turnaround', label: COLUMN.turnaround, requirement: 'optional', width: 16, note: 'phút', guide: 'Thời gian dự kiến có kết quả, số nguyên dương tính bằng phút (tối đa 43.200 = 30 ngày).' },
  { key: 'resultType', label: COLUMN.resultType, requirement: 'optional', width: 20, guide: 'Theo chỉ số / Mô tả + kết luận / Cả hai. Để trống = mặc định theo loại (Xét nghiệm: Theo chỉ số; Chẩn đoán hình ảnh: Mô tả + kết luận; Thăm dò chức năng: Cả hai).' },
  { key: 'unit', label: COLUMN.unit, requirement: 'inHouseRequired', width: 14, guide: 'Đơn vị tính của giá (Lần, Ca...). Gõ TÊN; chưa có trong danh mục thì tự tạo mới. Dịch vụ chỉ định ra ngoài phải để trống.' },
  {
    key: 'price',
    label: COLUMN.price,
    requirement: 'inHouseRequired',
    width: 14,
    guide: 'Đơn giá gốc của dịch vụ, số nguyên, đơn vị đồng (VNĐ), ví dụ 80000; áp dụng từ hôm nhập, tính theo Loại giá mặc định của phòng khám. Dịch vụ chỉ định ra ngoài phải để trống. Giá theo ngày hẹn/khuyến mại cài ở màn Dịch vụ và Bảng giá.',
  },
];

/** Dữ liệu ví dụ trong file mẫu (3 dòng) — Tên bắt đầu bằng `VD-` nên bị bỏ qua khi nhập. */
export const SERVICE_EXAMPLES: ImportRecord[] = [
  {
    kind: 'Xét nghiệm', name: 'VD-Công thức máu', shortName: 'CTM', category: 'Huyết học', specimen: 'Máu toàn phần', inHouse: 'Có', turnaround: 60, resultType: 'Theo chỉ số', unit: 'Lần', price: 80000,
  },
  {
    kind: 'Chẩn đoán hình ảnh', name: 'VD-Siêu âm bụng tổng quát', category: 'Siêu âm', inHouse: 'Có', turnaround: 30, resultType: 'Mô tả + kết luận', unit: 'Lần', price: 150000,
  },
  {
    kind: 'Xét nghiệm', name: 'VD-Xét nghiệm gen (gửi ngoài)', category: 'Sinh học phân tử', specimen: 'Máu toàn phần', inHouse: 'Không',
  },
];
