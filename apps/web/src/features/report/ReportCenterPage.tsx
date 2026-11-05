import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { useFilterByPermission } from '../auth/usePermission';
import { exportLabel, filterReportCatalog, groupReportCatalog, REPORT_CATALOG } from './report-catalog';

const COLUMNS = 'minmax(0,1fr) 190px 120px 56px';

/**
 * "Trung tâm báo cáo" (docs/DECISIONS.md #287, mockup đã duyệt 05/11/2026): một chỗ liệt kê MỌI báo cáo đã có, có ô tìm. Chỉ hiện báo cáo người xem mở được (cùng quyền với route/menu).
 * Báo cáo cũ ở Sổ quỹ/Kho/Quản trị giữ nguyên chỗ cũ, trang này chỉ liên kết tới.
 */
export function ReportCenterPage() {
  useBreadcrumb([{ label: 'Báo cáo' }, { label: 'Trung tâm báo cáo' }]);
  const [keyword, setKeyword] = useState('');
  const visible = useFilterByPermission(REPORT_CATALOG.map((r) => ({ ...r, permission: r.permission })));
  const groups = groupReportCatalog(filterReportCatalog(visible, keyword));

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-6">
      <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-4">
        <h1 className="text-[22px] font-semibold text-slate-900">Trung tâm báo cáo</h1>
        <div>
          <label htmlFor="report-search" className="sr-only">
            Tìm báo cáo
          </label>
          <input
            id="report-search"
            type="search"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="Tìm báo cáo…"
            className="h-9 w-72 rounded-md border border-slate-300 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-500 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600"
          />
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="grid items-center gap-x-4 border-b border-slate-200 px-4 py-2.5 text-xs font-semibold uppercase tracking-wide text-slate-600" style={{ gridTemplateColumns: COLUMNS }}>
          <div>Báo cáo</div>
          <div>Xem theo</div>
          <div>Xuất</div>
          <div />
        </div>
        {groups.length === 0 && (
          <p className="px-4 py-8 text-center text-sm text-slate-600">{keyword.trim() ? 'Không có báo cáo nào khớp từ khoá.' : 'Tài khoản này chưa được cấp quyền xem báo cáo nào.'}</p>
        )}
        {groups.map(({ group, items }) => (
          <div key={group}>
            <div className="border-b border-slate-100 bg-slate-50 px-4 py-2.5 text-sm font-semibold text-slate-800">{group}</div>
            {items.map((r) => (
              <div key={r.id} className="grid items-center gap-x-4 border-b border-slate-50 px-4 py-2.5" style={{ gridTemplateColumns: COLUMNS }}>
                <div className="min-w-0">
                  <div className="font-semibold text-slate-900">{r.name}</div>
                  <div className="mt-0.5 text-[12.5px] text-slate-600">{r.description}</div>
                </div>
                <div className="text-[13px] text-slate-700">{r.scope}</div>
                <div className="text-[13px] text-slate-700">{exportLabel(r)}</div>
                <div>
                  <Link to={r.to} className="text-sm font-semibold text-blue-600 hover:text-blue-700 hover:underline">
                    Mở
                  </Link>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
