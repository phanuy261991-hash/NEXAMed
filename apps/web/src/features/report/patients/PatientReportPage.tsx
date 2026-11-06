import { useSearchParams } from 'react-router-dom';
import { useBreadcrumb } from '../../../shared/layout/breadcrumb.context';
import { TabBar } from '../../../shared/ui/TabBar';
import { useReportScope } from '../../branch/useReportScope';
import { useReportPeriod } from '../useReportPeriod';
import { PatientDemographicsTab } from './PatientDemographicsTab';
import { PatientNewReturningTab } from './PatientNewReturningTab';
import { PatientNotReturningTab } from './PatientNotReturningTab';

const TABS = [
  { id: 'new-returning', label: 'Bệnh nhân mới và cũ' },
  { id: 'demographics', label: 'Tuổi, giới và địa bàn' },
  { id: 'not-returning', label: 'Bệnh nhân không quay lại' },
] as const;

type TabId = (typeof TABS)[number]['id'];

function parseTab(raw: string | null): TabId {
  return TABS.find((t) => t.id === raw)?.id ?? 'new-returning';
}

/**
 * Trang "Bệnh nhân" (docs/DECISIONS.md #287): 3 tab — Bệnh nhân mới và cũ, Tuổi giới và địa bàn, Bệnh nhân không quay lại (nhớ trong `?tab=`). Kỳ và phạm vi chi nhánh được giữ chung giữa
 * các tab (đổi tab không phải chọn lại). Quyền: `patient_report.read` (mặc định chỉ quản lý phòng khám).
 */
export function PatientReportPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = parseTab(searchParams.get('tab'));
  // Đường dẫn 3 cấp như các trang báo cáo khác: Báo cáo / Bệnh nhân / tên tab đang xem.
  useBreadcrumb([{ label: 'Báo cáo' }, { label: 'Bệnh nhân' }, { label: TABS.find((x) => x.id === tab)?.label ?? '' }]);
  const scope = useReportScope();
  const period = useReportPeriod('thisMonth');

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-6">
      <h1 className="flex-shrink-0 text-[22px] font-semibold text-slate-900">Bệnh nhân</h1>
      <TabBar tabs={[...TABS]} active={tab} onChange={(next) => setSearchParams(next === 'new-returning' ? {} : { tab: next }, { replace: true })} variant="underline" className="flex-shrink-0" />
      {tab === 'new-returning' && <PatientNewReturningTab period={period} scope={scope} />}
      {tab === 'demographics' && <PatientDemographicsTab period={period} scope={scope} />}
      {tab === 'not-returning' && <PatientNotReturningTab period={period} scope={scope} />}
    </div>
  );
}
