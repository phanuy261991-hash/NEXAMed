import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useBreadcrumb } from '../../../shared/layout/breadcrumb.context';
import { TabBar } from '../../../shared/ui/TabBar';
import { useReportScope } from '../../branch/useReportScope';
import { useDepartmentOptionsQuery } from '../../department/department.queries';
import { useReportPeriod } from '../useReportPeriod';
import { DoctorDepartmentFilter, type DoctorFilterState } from './DoctorDepartmentFilter';
import { DoctorHoursTab } from './DoctorHoursTab';
import { DoctorOrderMixTab } from './DoctorOrderMixTab';
import { DoctorPerformanceTab } from './DoctorPerformanceTab';

const TABS = [
  { id: 'performance', label: 'Hiệu suất theo bác sĩ' },
  { id: 'order-mix', label: 'Cơ cấu kê đơn và chỉ định' },
  { id: 'hours', label: 'Giờ làm việc và lượt khám' },
] as const;

type TabId = (typeof TABS)[number]['id'];

function parseTab(raw: string | null): TabId {
  return TABS.find((t) => t.id === raw)?.id ?? 'performance';
}

/**
 * Trang "Bác sĩ" (docs/DECISIONS.md #287, mockup đã duyệt 05/11/2026): 3 tab — Hiệu suất theo bác sĩ, Cơ cấu kê đơn và chỉ định, Giờ làm việc và lượt khám (nhớ trong `?tab=`). Kỳ, phạm vi chi nhánh
 * và Khoa được giữ chung giữa các tab (đổi tab không phải chọn lại). Quyền: `doctor_report.read` (mặc định chỉ quản lý phòng khám; bác sĩ không xem trang này).
 */
export function DoctorReportPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = parseTab(searchParams.get('tab'));
  // Đường dẫn 3 cấp như mockup: Báo cáo / Bác sĩ / tên tab đang xem.
  useBreadcrumb([{ label: 'Báo cáo' }, { label: 'Bác sĩ' }, { label: TABS.find((x) => x.id === tab)?.label ?? '' }]);
  const scope = useReportScope();
  const period = useReportPeriod('thisMonth');
  const [departmentId, setDepartmentId] = useState('');
  const departments = useDepartmentOptionsQuery(false);
  const filter: DoctorFilterState = useMemo(
    () => ({
      departmentId,
      departmentLabel: departmentId ? ((departments.data?.items ?? []).find((d) => d.id === departmentId)?.name ?? null) : null,
      control: <DoctorDepartmentFilter value={departmentId} onChange={setDepartmentId} />,
    }),
    [departmentId, departments.data],
  );

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-6">
      <h1 className="flex-shrink-0 text-[22px] font-semibold text-slate-900">Bác sĩ</h1>
      <TabBar tabs={[...TABS]} active={tab} onChange={(next) => setSearchParams(next === 'performance' ? {} : { tab: next }, { replace: true })} variant="underline" className="flex-shrink-0" />
      {tab === 'performance' && <DoctorPerformanceTab period={period} scope={scope} filter={filter} />}
      {tab === 'order-mix' && <DoctorOrderMixTab period={period} scope={scope} filter={filter} />}
      {tab === 'hours' && <DoctorHoursTab period={period} scope={scope} filter={filter} />}
    </div>
  );
}
