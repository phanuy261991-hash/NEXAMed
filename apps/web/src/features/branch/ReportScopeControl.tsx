import { useEffect } from 'react';
import type { ReportScope } from '@nexamed/shared';
import { MultiSelectCombobox } from '../../shared/ui/MultiSelectCombobox';
import { SegmentedToggle } from '../../shared/ui/SegmentedToggle';
import { useAuthStore } from '../auth/auth.store';
import { BranchChip } from './BranchChip';
import { findCurrentBranch } from './branch-visibility';
import { useReportScopeBranchesQuery } from './branch.queries';
import { REPORT_SCOPE_LABELS } from './report-scope';
import type { ReportScopeState } from './useReportScope';

const SCOPE_ITEMS = (['current', 'all', 'pick'] as const).map((id) => ({ id, label: REPORT_SCOPE_LABELS[id] }));

/**
 * Bộ chọn "Phạm vi" DÙNG CHUNG cho mọi báo cáo tổng hợp nhiều chi nhánh (Đợt 3, docs/DECISIONS.md #235, mockup đã duyệt): đặt trong thanh lọc của từng báo cáo, cạnh "Từ ngày / Đến ngày".
 * Chỉ hiện với tài khoản có quyền `company_report.read` ở công ty từ 2 chi nhánh (`scope.canChoose`) — còn lại KHÔNG render gì (giao diện không đổi).
 * "Chọn chi nhánh" dùng `MultiSelectCombobox` có sẵn (không dựng popover tích riêng).
 */
export function ReportScopeControl({ scope }: { scope: ReportScopeState }) {
  const branchesQuery = useReportScopeBranchesQuery(scope.canChoose);
  const { selection, setBranchIds } = scope;
  const branches = branchesQuery.data?.items;

  // Lựa chọn đã lưu có thể trỏ tới chi nhánh không còn tồn tại — tự bỏ khỏi danh sách để không gửi id lạ lên máy chủ (404).
  useEffect(() => {
    if (!branches || selection.scope !== 'pick') return;
    const known = new Set(branches.map((b) => b.id));
    const kept = selection.branchIds.filter((id) => known.has(id));
    if (kept.length !== selection.branchIds.length) setBranchIds(kept);
  }, [branches, selection.scope, selection.branchIds, setBranchIds]);

  if (!scope.canChoose) return null;

  const options = (branches ?? []).map((b) => ({ value: b.id, label: b.isActive ? b.name : `${b.name} (đã ngưng)` }));

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-semibold text-slate-800">Phạm vi</span>
        <SegmentedToggle<ReportScope> items={SCOPE_ITEMS} value={selection.scope} onChange={scope.setScope} ariaLabel="Phạm vi chi nhánh của báo cáo" />
      </div>
      {selection.scope === 'pick' && (
        <div className="flex min-w-[260px] flex-col gap-1.5">
          <label htmlFor="report-scope-branches" className="text-sm font-semibold text-slate-800">
            Chi nhánh
          </label>
          <MultiSelectCombobox id="report-scope-branches" values={selection.branchIds} options={options} onChange={setBranchIds} placeholder="Chọn chi nhánh..." chips />
        </div>
      )}
    </>
  );
}

/** Dòng "Đang xem ..." kèm nhãn từng chi nhánh trong phạm vi — nhắc người xem số liệu đang gộp những đâu. Không render gì khi không chọn được phạm vi. */
export function ReportScopeSummary({ scope }: { scope: ReportScopeState }) {
  const branchesQuery = useReportScopeBranchesQuery(scope.canChoose);
  const currentBranch = useAuthStore((s) => findCurrentBranch(s.user));
  if (!scope.canChoose) return null;

  const { selection } = scope;
  const all = branchesQuery.data?.items ?? [];
  let names: string[];
  let label: string;
  if (selection.scope === 'all') {
    names = all.map((b) => b.name);
    label = `Đang xem tổng cả công ty${names.length > 0 ? ` (${names.length} chi nhánh)` : ''}`;
  } else if (selection.scope === 'pick') {
    names = all.filter((b) => selection.branchIds.includes(b.id)).map((b) => b.name);
    label = `Đang xem ${selection.branchIds.length} chi nhánh đã chọn`;
  } else {
    names = currentBranch ? [currentBranch.name] : [];
    label = 'Đang xem riêng';
  }

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-slate-700">
      <span className="font-medium">{label}:</span>
      {names.map((name) => (
        <BranchChip key={name} name={name} />
      ))}
    </div>
  );
}
