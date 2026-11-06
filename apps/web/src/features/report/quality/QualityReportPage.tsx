import { useNavigate, useSearchParams } from 'react-router-dom';
import { useBreadcrumb } from '../../../shared/layout/breadcrumb.context';
import { TabBar, type TabBarItem } from '../../../shared/ui/TabBar';
import { useFilterByPermission } from '../../auth/usePermission';
import { useReportScope } from '../../branch/useReportScope';
import { useReportPeriod } from '../useReportPeriod';
import { QualityIncompleteTab } from './QualityIncompleteTab';
import { QualityInteropTab } from './QualityInteropTab';
import { QUALITY_DEFAULT_TAB, QUALITY_TABS, parseQualityTab } from './quality-model';

/**
 * Trang "Chất lượng và tuân thủ" (docs/DECISIONS.md #290, mockup đã duyệt 05/11/2026): 3 tab — Lượt khám chưa hoàn tất (ảnh chụp đến hôm nay, không theo kỳ), Liên thông đơn thuốc (theo kỳ ký đơn),
 * Nhật ký kiểm toán. "Nhật ký kiểm toán" là trang đã có (`/admin/activity-log`) nên bấm tab là chuyển sang trang đó, chỉ hiện khi người xem có quyền xem nhật ký; hai tab còn lại nhớ trong `?tab=`.
 * Kỳ và phạm vi chi nhánh được giữ chung giữa các tab. Quyền của trang: `quality_report.read` (mặc định chỉ quản lý phòng khám).
 */
export function QualityReportPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const tab = parseQualityTab(searchParams.get('tab'));
  // Đường dẫn 3 cấp như các trang báo cáo khác: Báo cáo / Chất lượng và tuân thủ / tên tab đang xem.
  useBreadcrumb([{ label: 'Báo cáo' }, { label: 'Chất lượng và tuân thủ' }, { label: QUALITY_TABS.find((x) => x.id === tab)?.label ?? '' }]);
  const scope = useReportScope();
  const period = useReportPeriod('thisMonth');

  // Tab dẫn sang trang khác chỉ hiện khi có quyền của trang đích (cùng quyền route).
  const visibleTabs = useFilterByPermission(QUALITY_TABS.map((t) => ({ ...t, permission: 'permission' in t ? t.permission : undefined })));
  const tabs: TabBarItem<string>[] = visibleTabs.map((t) => ({ id: t.id, label: t.label }));

  const onChangeTab = (next: string) => {
    const link = QUALITY_TABS.find((t) => t.id === next);
    if (link && 'to' in link) {
      navigate(link.to);
      return;
    }
    setSearchParams(next === QUALITY_DEFAULT_TAB ? {} : { tab: next }, { replace: true });
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-6">
      <h1 className="flex-shrink-0 text-[22px] font-semibold text-slate-900">Chất lượng và tuân thủ</h1>
      <TabBar tabs={tabs} active={tab} onChange={onChangeTab} variant="underline" className="flex-shrink-0" />
      {tab === 'incomplete' && <QualityIncompleteTab period={period} scope={scope} />}
      {tab === 'interop' && <QualityInteropTab period={period} scope={scope} />}
    </div>
  );
}
