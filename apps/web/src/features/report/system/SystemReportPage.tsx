import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useBreadcrumb } from '../../../shared/layout/breadcrumb.context';
import { TabBar } from '../../../shared/ui/TabBar';
import { useReportScope } from '../../branch/useReportScope';
import { useReportPeriod } from '../useReportPeriod';
import { SystemCrossTab } from './SystemCrossTab';
import { SystemMonthlyTab } from './SystemMonthlyTab';
import { SystemOverviewTab } from './SystemOverviewTab';
import { SystemRankingTab } from './SystemRankingTab';
import { parseSystemTab, previousMonthOf, SYSTEM_DEFAULT_TAB, SYSTEM_TABS, type RankingKind } from './system-model';

/**
 * Trang "Toàn hệ thống" (docs/DECISIONS.md #287, mockup đã duyệt 05/11/2026): 4 tab — So sánh chi nhánh, Xếp hạng, Tổng hợp tháng, Khám chéo chi nhánh (nhớ trong `?tab=`). Kỳ và phạm vi chi nhánh
 * giữ chung giữa các tab; phạm vi mặc định là TẤT CẢ chi nhánh (đúng mockup) khi chưa từng chọn. Quyền: `company_report.read` ("Xem báo cáo toàn công ty", mặc định chỉ quản lý phòng khám).
 */
export function SystemReportPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = parseSystemTab(searchParams.get('tab'));
  // Đường dẫn như mockup: Báo cáo / Toàn hệ thống (kèm tên tab đang xem ở các tab sau tab đầu).
  useBreadcrumb([{ label: 'Báo cáo' }, { label: 'Toàn hệ thống' }, ...(tab === SYSTEM_DEFAULT_TAB ? [] : [{ label: SYSTEM_TABS.find((x) => x.id === tab)?.label ?? '' }])]);
  const scope = useReportScope('all');
  const period = useReportPeriod('thisMonth');
  const [rankingKind, setRankingKind] = useState<RankingKind>('services');
  const [month, setMonth] = useState(() => previousMonthOf(period.today));

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-6">
      <h1 className="flex-shrink-0 text-[22px] font-semibold text-slate-900">Toàn hệ thống</h1>
      <TabBar tabs={[...SYSTEM_TABS]} active={tab} onChange={(next) => setSearchParams(next === SYSTEM_DEFAULT_TAB ? {} : { tab: next }, { replace: true })} variant="underline" className="flex-shrink-0" />
      {tab === 'overview' && <SystemOverviewTab period={period} scope={scope} />}
      {tab === 'ranking' && <SystemRankingTab period={period} scope={scope} kind={rankingKind} onKindChange={setRankingKind} />}
      {tab === 'monthly' && <SystemMonthlyTab scope={scope} month={month} onMonthChange={setMonth} today={period.today} />}
      {tab === 'cross' && <SystemCrossTab period={period} scope={scope} />}
    </div>
  );
}
