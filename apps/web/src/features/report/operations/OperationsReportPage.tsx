import { useSearchParams } from 'react-router-dom';
import { useBreadcrumb } from '../../../shared/layout/breadcrumb.context';
import { TabBar } from '../../../shared/ui/TabBar';
import { useReportScope } from '../../branch/useReportScope';
import { useReportPeriod } from '../useReportPeriod';
import { BookingSourcesTab } from './BookingSourcesTab';
import { CancellationsTab } from './CancellationsTab';
import { FollowUpsTab } from './FollowUpsTab';
import { PeakHoursTab } from './PeakHoursTab';
import { VisitBookTab } from './VisitBookTab';
import { WaitingTab } from './WaitingTab';

const TABS = [
  { id: 'visit-book', label: 'Sổ khám bệnh' },
  { id: 'peak-hours', label: 'Giờ cao điểm' },
  { id: 'waiting', label: 'Thời gian chờ' },
  { id: 'cancellations', label: 'Huỷ và không đến' },
  { id: 'follow-ups', label: 'Tái khám' },
  { id: 'booking-sources', label: 'Nguồn đặt lịch' },
] as const;

type TabId = (typeof TABS)[number]['id'];

function parseTab(raw: string | null): TabId {
  return TABS.find((t) => t.id === raw)?.id ?? 'visit-book';
}

/**
 * Trang "Khám bệnh và vận hành" (docs/DECISIONS.md #287, mockup đã duyệt 05/11/2026): 6 tab — Sổ khám bệnh, Giờ cao điểm, Thời gian chờ, Huỷ và không đến, Tái khám, Nguồn đặt lịch (nhớ trong `?tab=`).
 * Kỳ và phạm vi chi nhánh được giữ chung giữa các tab theo kỳ (đổi tab không phải chọn lại); Sổ khám bệnh có ô Từ ngày/Đến ngày riêng như mockup. Quyền: `operations_report.read` (mặc định chỉ quản lý phòng khám).
 */
export function OperationsReportPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = parseTab(searchParams.get('tab'));
  // Đường dẫn 3 cấp như mockup: Báo cáo / Khám bệnh và vận hành / tên tab đang xem.
  useBreadcrumb([{ label: 'Báo cáo' }, { label: 'Khám bệnh và vận hành' }, { label: TABS.find((x) => x.id === tab)?.label ?? '' }]);
  const scope = useReportScope();
  const period = useReportPeriod('thisMonth');

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-6">
      <h1 className="flex-shrink-0 text-[22px] font-semibold text-slate-900">Khám bệnh và vận hành</h1>
      <TabBar tabs={[...TABS]} active={tab} onChange={(next) => setSearchParams(next === 'visit-book' ? {} : { tab: next }, { replace: true })} variant="underline" className="flex-shrink-0" />
      {tab === 'visit-book' && <VisitBookTab scope={scope} />}
      {tab === 'peak-hours' && <PeakHoursTab period={period} scope={scope} />}
      {tab === 'waiting' && <WaitingTab period={period} scope={scope} />}
      {tab === 'cancellations' && <CancellationsTab period={period} scope={scope} />}
      {tab === 'follow-ups' && <FollowUpsTab period={period} scope={scope} />}
      {tab === 'booking-sources' && <BookingSourcesTab period={period} scope={scope} />}
    </div>
  );
}
