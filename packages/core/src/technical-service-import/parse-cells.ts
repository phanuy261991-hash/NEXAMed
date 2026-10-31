import { TECHNICAL_SERVICE_KIND_LABELS, type TechnicalServiceKind, type TechnicalServiceResultType } from '@nexamed/shared';
import { lookup, type ImportParseResult } from '../drug-import/parse-cells';

/**
 * Đọc ô Excel của "Nhập Excel Dịch vụ kỹ thuật" (docs/DECISIONS.md #276) — hàm THUẦN, cùng quy ước `drug-import/parse-cells.ts`: ô trống → `value = null`,
 * nhãn lạ → `{ ok: false }` (người gọi báo lỗi dòng kèm tên cột). Nhãn tiếng Việt MỘT nơi để file mẫu, file xuất và bộ đọc không lệch nhau.
 */
export const IMPORT_SERVICE_KIND_LABELS: Record<TechnicalServiceKind, string> = TECHNICAL_SERVICE_KIND_LABELS;

export const IMPORT_RESULT_TYPE_LABELS: Record<TechnicalServiceResultType, string> = {
  INDICATORS: 'Theo chỉ số',
  NARRATIVE: 'Mô tả + kết luận',
  BOTH: 'Cả hai',
};

const SERVICE_KIND_TABLE: Record<string, TechnicalServiceKind> = {
  'xet nghiem': 'LAB',
  xn: 'LAB',
  lab: 'LAB',
  'chan doan hinh anh': 'IMAGING',
  cdha: 'IMAGING',
  imaging: 'IMAGING',
  'tham do chuc nang': 'FUNCTIONAL',
  tdcn: 'FUNCTIONAL',
  functional: 'FUNCTIONAL',
};

const RESULT_TYPE_TABLE: Record<string, TechnicalServiceResultType> = {
  'theo chi so': 'INDICATORS',
  'chi so': 'INDICATORS',
  indicators: 'INDICATORS',
  'mo ta + ket luan': 'NARRATIVE',
  'mo ta': 'NARRATIVE',
  narrative: 'NARRATIVE',
  'ca hai': 'BOTH',
  both: 'BOTH',
};

export function parseImportServiceKind(raw: string | number | null | undefined): ImportParseResult<TechnicalServiceKind> {
  return lookup(raw, SERVICE_KIND_TABLE);
}

/** Bỏ trống → `value = null` (người gọi dùng kiểu mặc định theo loại dịch vụ). */
export function parseImportResultType(raw: string | number | null | undefined): ImportParseResult<TechnicalServiceResultType> {
  return lookup(raw, RESULT_TYPE_TABLE);
}
