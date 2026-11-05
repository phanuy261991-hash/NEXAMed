/**
 * Mô tả một bản in BÁO CÁO dạng bảng (docs/DECISIONS.md #287: mọi báo cáo phải in được trực tiếp). Mỗi báo cáo tự đổi dữ liệu đang xem thành `ReportPrintSpec` (hàm thuần, có test),
 * `ReportTablePrintView` vẽ ra giấy qua `PrintDocument` (loại chứng từ `REPORT`). Nhận dữ liệu qua tham số — không biết gì về nghiệp vụ của từng báo cáo.
 */
export interface ReportPrintColumn {
  header: string;
  align?: 'left' | 'right' | 'center';
  /** Độ rộng CSS (`'90px'`, `'20%'`); bỏ trống = chia theo nội dung. */
  width?: string;
}

export interface ReportPrintSection {
  /** Tiêu đề khối (in đậm trên bảng); bỏ trống nếu báo cáo chỉ có một bảng. */
  title?: string;
  columns: ReportPrintColumn[];
  rows: string[][];
  /** Dòng cộng/tổng in đậm ngay dưới các dòng dữ liệu. */
  totalRows?: string[][];
  /** Chữ thay cho bảng khi không có dòng nào. */
  emptyText?: string;
}

export interface ReportPrintSpec {
  title: string;
  /** Các dòng dưới tiêu đề: kỳ báo cáo, phạm vi chi nhánh, bộ lọc đang áp... */
  subtitleLines?: string[];
  /** Các dòng số liệu tóm tắt đặt NGAY TRÊN bảng (ví dụ "Số dư đầu kỳ: ..."). */
  infoLines?: string[];
  sections: ReportPrintSection[];
  /** Ghi chú cuối báo cáo (ví dụ "Chỉ in 5.000 dòng đầu"). */
  note?: string;
  /** Nhãn các ô ký; mặc định "Người lập" và "Quản lý". Mảng rỗng = không có ô ký. */
  signatures?: string[];
}

/** Tối đa số dòng một bản in tải được (danh sách theo trang): quá thì in phần đầu và ghi chú rõ. */
export const REPORT_PRINT_ROW_CAP = 5000;

export const DEFAULT_REPORT_SIGNATURES = ['Người lập', 'Quản lý'];
