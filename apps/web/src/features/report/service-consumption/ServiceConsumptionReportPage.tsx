import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useBreadcrumb } from '../../../shared/layout/breadcrumb.context';
import { Combobox } from '../../../shared/ui/Combobox';
import { TabBar, type TabBarItem } from '../../../shared/ui/TabBar';
import { useDoctorsQuery } from '../../appointment/appointment.queries';
import { useReportScope } from '../../branch/useReportScope';
import { useReportPeriod } from '../useReportPeriod';
import { SERVICE_CONSUMPTION_DEFAULT_TAB, SERVICE_CONSUMPTION_TABS, parseServiceConsumptionTab } from './service-consumption-report-model';
import { useServiceConsumptionByServiceQuery } from './service-consumption-report.queries';
import { ServiceConsumptionByCustomerTab, ServiceConsumptionByServiceTab, type ServiceConsumptionFilter } from './ServiceConsumptionTabs';

const ALL_SERVICES = '';

/**
 * Trang "Chi phí vật tư theo dịch vụ" (docs/DECISIONS.md #297 GĐ4, mockup màn 9): 2 tab — Theo dịch vụ, Theo khách (nhớ trong `?tab=`). Kỳ, phạm vi chi nhánh, Dịch vụ và Bác sĩ giữ chung giữa các tab.
 * Quyền: `service_consumption.report` (mặc định chỉ quản lý phòng khám vì có giá vốn). Danh sách "Dịch vụ" lấy từ chính báo cáo (các dịch vụ có ghi tiêu hao trong kỳ, không thu hẹp theo bộ lọc).
 * KHÔNG phải báo cáo lãi lỗ: chi phí này không trừ vào lãi gộp.
 */
export function ServiceConsumptionReportPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tab = parseServiceConsumptionTab(searchParams.get('tab'));
  useBreadcrumb([{ label: 'Báo cáo' }, { label: 'Chi phí vật tư theo dịch vụ' }, { label: SERVICE_CONSUMPTION_TABS.find((t) => t.id === tab)?.label ?? '' }]);
  const scope = useReportScope();
  const period = useReportPeriod('thisMonth');
  const [serviceKey, setServiceKey] = useState(ALL_SERVICES);
  const [doctorId, setDoctorId] = useState('');

  // Danh sách dịch vụ để chọn: báo cáo "Theo dịch vụ" CHƯA lọc (cùng khoá bộ nhớ đệm với tab khi chưa chọn bộ lọc nên không tải thêm).
  const optionsQuery = useServiceConsumptionByServiceQuery({ from: period.range.from, to: period.range.to, ...scope.selection }, period.error === null);
  const serviceOptions = useMemo(
    () => [{ value: ALL_SERVICES, label: 'Tất cả dịch vụ' }, ...(optionsQuery.data?.serviceOptions ?? []).map((o) => ({ value: o.key, label: o.name }))],
    [optionsQuery.data],
  );
  const doctorsQuery = useDoctorsQuery();
  const doctorOptions = useMemo(() => [{ value: '', label: 'Tất cả' }, ...(doctorsQuery.data?.items ?? []).map((d) => ({ value: d.id, label: d.displayName ?? d.fullName }))], [doctorsQuery.data]);

  const filter: ServiceConsumptionFilter = useMemo(
    () => ({
      serviceKey,
      doctorId,
      control: (
        <>
          <div className="flex w-[240px] flex-col gap-1.5">
            <label htmlFor="sc-service" className="text-sm font-semibold text-slate-800">
              Dịch vụ
            </label>
            <Combobox id="sc-service" value={serviceKey} options={serviceOptions} onChange={setServiceKey} placeholder="Tất cả dịch vụ" />
          </div>
          <div className="flex w-[200px] flex-col gap-1.5">
            <label htmlFor="sc-doctor" className="text-sm font-semibold text-slate-800">
              Bác sĩ
            </label>
            <Combobox id="sc-doctor" value={doctorId} options={doctorOptions} onChange={setDoctorId} placeholder="Tất cả" />
          </div>
        </>
      ),
    }),
    [serviceKey, doctorId, serviceOptions, doctorOptions],
  );

  const tabs: TabBarItem<string>[] = SERVICE_CONSUMPTION_TABS.map((t) => ({ id: t.id, label: t.label }));
  const onChangeTab = (next: string) => setSearchParams(next === SERVICE_CONSUMPTION_DEFAULT_TAB ? {} : { tab: next }, { replace: true });

  return (
    <div className="flex h-full min-h-0 flex-col gap-4 overflow-y-auto p-6">
      <h1 className="flex-shrink-0 text-[22px] font-semibold text-slate-900">Chi phí vật tư theo dịch vụ</h1>
      <TabBar tabs={tabs} active={tab} onChange={onChangeTab} variant="underline" className="flex-shrink-0" />
      {tab === 'by-service' && <ServiceConsumptionByServiceTab period={period} scope={scope} filter={filter} />}
      {tab === 'by-customer' && <ServiceConsumptionByCustomerTab period={period} scope={scope} filter={filter} />}
    </div>
  );
}
