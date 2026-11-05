import { useSearchParams } from 'react-router-dom';
import { useBreadcrumb } from '../../../shared/layout/breadcrumb.context';
import { TabBar } from '../../../shared/ui/TabBar';
import { useReportScope } from '../../branch/useReportScope';
import { useReportPeriod } from '../useReportPeriod';
import { RevenueByCashierTab } from './RevenueByCashierTab';
import { RevenueByMethodTab } from './RevenueByMethodTab';
import { RevenueByPeriodTab } from './RevenueByPeriodTab';
import { RevenueByServiceTab } from './RevenueByServiceTab';
import { RevenueUnpaidTab } from './RevenueUnpaidTab';

const TABS = [
  { id: 'by-period', label: 'Theo kỳ' },
  { id: 'by-service', label: 'Theo nhóm và dịch vụ' },
  { id: 'by-method', label: 'Theo phương thức' },
  { id: 'unpaid', label: 'Phiếu chưa thu' },
  { id: 'by-cashier', label: 'Theo thu ngân và chốt ca' },
] as const;

type TabId = (typeof TABS)[number]['id'];

function parseTab(raw: string | null): TabId {
  return TABS.find((t) => t.id === raw)?.id ?? 'by-period';
}

/**
 * Trang "Doanh thu" (docs/DECISIONS.md #287, mockup đã duyệt 05/11/2026): 5 tab — Theo kỳ, Theo nhóm và dịch vụ, Theo phương thức, Phiếu chưa thu, Theo thu ngân và chốt ca (nhớ trong `?tab=`).
 * Kỳ và phạm vi chi nhánh được giữ chung giữa các tab (đổi tab không phải chọn lại). Quyền: `revenue_report.read` (mặc định chỉ quản lý phòng khám).
 */
export function RevenueReportPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = parseTab(searchParams.get('tab'));
  // Đường dẫn 3 cấp như mockup: Báo cáo / Doanh thu / tên tab đang xem.
  useBreadcrumb([{ label: 'Báo cáo' }, { label: 'Doanh thu' }, { label: TABS.find((x) => x.id === tab)?.label ?? '' }]);
  const scope = useReportScope();
  const period = useReportPeriod('year');

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-6">
      <h1 className="flex-shrink-0 text-[22px] font-semibold text-slate-900">Doanh thu</h1>
      <TabBar tabs={[...TABS]} active={tab} onChange={(next) => setSearchParams(next === 'by-period' ? {} : { tab: next }, { replace: true })} variant="underline" className="flex-shrink-0" />
      {tab === 'by-period' && <RevenueByPeriodTab period={period} scope={scope} />}
      {tab === 'by-service' && <RevenueByServiceTab period={period} scope={scope} />}
      {tab === 'by-method' && <RevenueByMethodTab period={period} scope={scope} />}
      {tab === 'unpaid' && <RevenueUnpaidTab period={period} scope={scope} />}
      {tab === 'by-cashier' && <RevenueByCashierTab period={period} scope={scope} />}
    </div>
  );
}
