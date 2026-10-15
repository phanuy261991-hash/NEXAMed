import type { ReportScope, ReportScopeSelection } from '@nexamed/shared';

// apps/web chỉ import KIỂU từ @nexamed/shared (bản dist là CommonJS, không import giá trị được ở Vite dev) — danh sách phạm vi khai báo cục bộ, `satisfies` giữ khớp kiểu dùng chung.
const REPORT_SCOPE_VALUES = ['current', 'all', 'pick'] as const satisfies readonly ReportScope[];

/**
 * Phạm vi chi nhánh của BÁO CÁO TỔNG HỢP (Đợt 3 chi nhánh, docs/DECISIONS.md #235) — phần thuần, dùng chung Báo cáo dòng tiền / Sổ quỹ / Nhập-Xuất-Tồn (và báo cáo gộp sau này).
 * `current` = chi nhánh đang làm; `all` = mọi chi nhánh; `pick` = các chi nhánh trong `branchIds`. Máy chủ vẫn kiểm quyền `company_report.read` — đây chỉ là cách web biểu diễn lựa chọn.
 */
export const CURRENT_REPORT_SCOPE: ReportScopeSelection = { scope: 'current', branchIds: [] };

export const REPORT_SCOPE_LABELS: Record<ReportScope, string> = {
  current: 'Chi nhánh đang làm',
  all: 'Tất cả chi nhánh',
  pick: 'Chọn chi nhánh',
};

/** Đọc lại lựa chọn đã lưu (localStorage) — dữ liệu hỏng/lạ trả về `current` thay vì ném lỗi. */
export function parseStoredReportScope(raw: unknown): ReportScopeSelection {
  if (typeof raw !== 'object' || raw === null) return CURRENT_REPORT_SCOPE;
  const { scope, branchIds } = raw as { scope?: unknown; branchIds?: unknown };
  if (typeof scope !== 'string' || !(REPORT_SCOPE_VALUES as readonly string[]).includes(scope)) return CURRENT_REPORT_SCOPE;
  const ids = Array.isArray(branchIds) ? branchIds.filter((x): x is string => typeof x === 'string') : [];
  if (scope === 'pick') return ids.length > 0 ? { scope: 'pick', branchIds: ids } : CURRENT_REPORT_SCOPE;
  return { scope: scope as ReportScope, branchIds: [] };
}

/**
 * Đổi query của báo cáo (có `scope` + `branchIds` dạng mảng) sang tham số gửi API: `branchIds` thành chuỗi cách nhau bằng dấu phẩy và CHỈ gửi khi `scope='pick'`;
 * `scope='current'` không gửi gì thêm để request y hệt trước Đợt 3.
 */
export function toReportScopeApiQuery<T extends ReportScopeSelection>(query: T): Omit<T, 'branchIds' | 'scope'> & { scope?: ReportScope; branchIds?: string } {
  const { scope, branchIds, ...rest } = query;
  return {
    ...rest,
    ...(scope === 'current' ? {} : { scope }),
    ...(scope === 'pick' ? { branchIds: branchIds.join(',') } : {}),
  };
}

/** Chuỗi query (`a=1&b=2`) cho đường dẫn tải Excel — bỏ giá trị rỗng/undefined. */
export function toQueryString(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, value);
  }
  return search.toString();
}

/** Báo cáo có gộp từ 2 chi nhánh trở lên không — quyết định hiện cột/bảng "Chi nhánh" (công ty/phạm vi 1 chi nhánh: giao diện không đổi). */
export function isMultiBranchScope(branchCount: number): boolean {
  return branchCount > 1;
}
