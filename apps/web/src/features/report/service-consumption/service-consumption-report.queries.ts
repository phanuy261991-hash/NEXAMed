import { useQuery } from '@tanstack/react-query';
import { useAppConfig } from '../../../app/AppConfigProvider';
import { queryKey } from '../../../shared/api/query-keys';
import { getServiceConsumptionByBranch, getServiceConsumptionByCustomer, getServiceConsumptionByItem, getServiceConsumptionByService, type ServiceConsumptionPeriodParams } from './service-consumption-report.api';

function periodKey(p: ServiceConsumptionPeriodParams): string {
  return JSON.stringify([p.from, p.to, p.scope, p.branchIds, p.serviceKey ?? '', p.doctorId ?? '']);
}

/** Số chỉ tải khi vào trang, đổi bộ lọc/kỳ/phạm vi hoặc bấm "Làm mới" (docs/DECISIONS.md #279): không tự làm mới nền. `enabled=false` khi kỳ tuỳ chọn đang nhập sai. */
function reportOptions(enabled: boolean) {
  return { enabled, staleTime: Infinity, refetchOnWindowFocus: false } as const;
}

export function useServiceConsumptionByServiceQuery(p: ServiceConsumptionPeriodParams, enabled: boolean) {
  const { tenantId } = useAppConfig();
  return useQuery({ queryKey: queryKey(tenantId, 'report', 'service-consumption', 'by-service', periodKey(p)), queryFn: () => getServiceConsumptionByService(p), ...reportOptions(enabled) });
}

export function useServiceConsumptionByCustomerQuery(p: ServiceConsumptionPeriodParams, enabled: boolean) {
  const { tenantId } = useAppConfig();
  return useQuery({ queryKey: queryKey(tenantId, 'report', 'service-consumption', 'by-customer', periodKey(p)), queryFn: () => getServiceConsumptionByCustomer(p), ...reportOptions(enabled) });
}

export function useServiceConsumptionByItemQuery(p: ServiceConsumptionPeriodParams, enabled: boolean) {
  const { tenantId } = useAppConfig();
  return useQuery({ queryKey: queryKey(tenantId, 'report', 'service-consumption', 'by-item', periodKey(p)), queryFn: () => getServiceConsumptionByItem(p), ...reportOptions(enabled) });
}

export function useServiceConsumptionByBranchQuery(p: ServiceConsumptionPeriodParams, enabled: boolean) {
  const { tenantId } = useAppConfig();
  return useQuery({ queryKey: queryKey(tenantId, 'report', 'service-consumption', 'by-branch', periodKey(p)), queryFn: () => getServiceConsumptionByBranch(p), ...reportOptions(enabled) });
}
