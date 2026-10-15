import { useCallback, useState } from 'react';
import type { ReportScope, ReportScopeSelection } from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { useAuthStore } from '../auth/auth.store';
import { useHasPermission } from '../auth/usePermission';
import { CURRENT_REPORT_SCOPE, parseStoredReportScope } from './report-scope';

export interface ReportScopeState {
  /** Tài khoản có chọn được phạm vi không: có quyền `company_report.read` VÀ công ty có từ 2 chi nhánh. Không thì mọi báo cáo luôn là chi nhánh đang làm. */
  canChoose: boolean;
  /** Phạm vi gửi lên máy chủ — luôn `current` khi `canChoose=false`, dù localStorage còn giá trị cũ. */
  selection: ReportScopeSelection;
  setScope: (scope: ReportScope) => void;
  setBranchIds: (branchIds: string[]) => void;
}

function readStored(key: string): ReportScopeSelection {
  try {
    const raw = localStorage.getItem(key);
    return raw ? parseStoredReportScope(JSON.parse(raw)) : CURRENT_REPORT_SCOPE;
  } catch {
    return CURRENT_REPORT_SCOPE;
  }
}

/**
 * Hook DÙNG CHUNG cho mọi báo cáo tổng hợp nhiều chi nhánh (Đợt 3, docs/DECISIONS.md #235). Lựa chọn được nhớ theo từng tài khoản trên trình duyệt (localStorage, bọc try/catch) và
 * dùng chung giữa các báo cáo, nên chuyển từ Báo cáo dòng tiền sang Nhập-Xuất-Tồn không phải chọn lại. KHÔNG phải nguồn sự thật về quyền — máy chủ vẫn từ chối `scope` khác `current`
 * nếu thiếu `company_report.read`.
 */
export function useReportScope(): ReportScopeState {
  const { tenantId } = useAppConfig();
  const user = useAuthStore((s) => s.user);
  const hasPermission = useHasPermission('company_report', 'read');
  const canChoose = hasPermission && user?.multiBranchCompany === true;
  const storageKey = `nexamed.reportScope.${tenantId}.${user?.id ?? 'anonymous'}`;

  const [stored, setStored] = useState<ReportScopeSelection>(() => readStored(storageKey));

  const persist = useCallback(
    (next: ReportScopeSelection) => {
      setStored(next);
      try {
        localStorage.setItem(storageKey, JSON.stringify(next));
      } catch {
        // Trình duyệt chặn lưu (cửa sổ ẩn danh...) — vẫn dùng được trong phiên này.
      }
    },
    [storageKey],
  );

  const currentBranchId = user?.currentBranchId ?? null;
  const setScope = useCallback(
    (scope: ReportScope) => {
      if (scope !== 'pick') return persist({ scope, branchIds: [] });
      // "Chọn chi nhánh" lần đầu: bắt đầu từ chi nhánh đang làm (máy chủ không nhận `pick` rỗng).
      const ids = stored.branchIds.length > 0 ? stored.branchIds : currentBranchId ? [currentBranchId] : [];
      persist(ids.length > 0 ? { scope: 'pick', branchIds: ids } : CURRENT_REPORT_SCOPE);
    },
    [persist, stored.branchIds, currentBranchId],
  );
  const setBranchIds = useCallback((branchIds: string[]) => persist(branchIds.length > 0 ? { scope: 'pick', branchIds } : CURRENT_REPORT_SCOPE), [persist]);

  return { canChoose, selection: canChoose ? stored : CURRENT_REPORT_SCOPE, setScope, setBranchIds };
}
