import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useBreadcrumb } from '../../../shared/layout/breadcrumb.context';
import { TabBar, type TabBarItem } from '../../../shared/ui/TabBar';
import { useFilterByPermission } from '../../auth/usePermission';
import { useReportScope } from '../../branch/useReportScope';
import { useReportPeriod } from '../useReportPeriod';
import { PharmacyControlledTab } from './PharmacyControlledTab';
import { PharmacyDispensedTab } from './PharmacyDispensedTab';
import { ControlledTypeControl, PharmacyItemTypeControl, type ControlledFilterState, type PharmacyFilterState } from './PharmacyItemFilter';
import { PharmacyMarginTab } from './PharmacyMarginTab';
import { PHARMACY_DEFAULT_TAB, PHARMACY_LINK_TABS, PHARMACY_OWN_TABS, parsePharmacyTab, type ControlledTypeFilter, type PharmacyItemFilter } from './pharmacy-model';

/**
 * Trang "Thuốc và vật tư" (docs/DECISIONS.md #287, mockup đã duyệt 05/11/2026): 7 tab — Đã phát, Lãi gộp, Kiểm soát đặc biệt (3 tab của trang này, nhớ trong `?tab=`) và bốn báo cáo kho đã có
 * (Nhập-Xuất-Tồn, Tồn kho và hạn dùng, Hao hụt điều chuyển, Công nợ nhà cung cấp) mà bấm tab là chuyển sang trang cũ, giữ đúng đường dẫn và quyền cũ (chủ dự án chọn 05/11/2026). Tab kho chỉ hiện khi
 * người xem có quyền của trang đó. Kỳ, phạm vi chi nhánh và Loại được giữ chung giữa các tab. Quyền của trang: `pharmacy_report.read` (mặc định chỉ quản lý phòng khám vì có giá vốn).
 */
export function PharmacyReportPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const tab = parsePharmacyTab(searchParams.get('tab'));
  // Đường dẫn 3 cấp như mockup: Báo cáo / Thuốc và vật tư / tên tab đang xem.
  useBreadcrumb([{ label: 'Báo cáo' }, { label: 'Thuốc và vật tư' }, { label: PHARMACY_OWN_TABS.find((x) => x.id === tab)?.label ?? '' }]);
  const scope = useReportScope();
  const period = useReportPeriod('thisMonth');
  const [itemType, setItemType] = useState<PharmacyItemFilter>('ALL');
  const [controlType, setControlType] = useState<ControlledTypeFilter>('ALL');
  const itemFilter: PharmacyFilterState = useMemo(() => ({ itemType, control: <PharmacyItemTypeControl value={itemType} onChange={setItemType} /> }), [itemType]);
  const controlledFilter: ControlledFilterState = useMemo(() => ({ controlType, control: <ControlledTypeControl value={controlType} onChange={setControlType} /> }), [controlType]);

  // Tab kho chỉ hiện khi có quyền của trang đích (cùng quyền route cũ).
  const linkTabs = useFilterByPermission(PHARMACY_LINK_TABS);
  const tabs: TabBarItem<string>[] = [...PHARMACY_OWN_TABS.map((t) => ({ id: t.id, label: t.label })), ...linkTabs.map((t) => ({ id: t.id, label: t.label }))];

  const onChangeTab = (next: string) => {
    const link = linkTabs.find((t) => t.id === next);
    if (link) {
      navigate(link.to);
      return;
    }
    setSearchParams(next === PHARMACY_DEFAULT_TAB ? {} : { tab: next }, { replace: true });
  };

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-6">
      <h1 className="flex-shrink-0 text-[22px] font-semibold text-slate-900">Thuốc và vật tư</h1>
      <TabBar tabs={tabs} active={tab} onChange={onChangeTab} variant="underline" className="flex-shrink-0" />
      {tab === 'dispensed' && <PharmacyDispensedTab period={period} scope={scope} filter={itemFilter} />}
      {tab === 'margin' && <PharmacyMarginTab period={period} scope={scope} filter={itemFilter} />}
      {tab === 'controlled' && <PharmacyControlledTab period={period} scope={scope} filter={controlledFilter} />}
    </div>
  );
}
