import { useQuery } from '@tanstack/react-query';
import { useAppConfig } from '../../../app/AppConfigProvider';
import { queryKey } from '../../../shared/api/query-keys';
import {
  getRevenueByCashier,
  getRevenueByMethod,
  getRevenueByPeriod,
  getRevenueByService,
  getRevenueUnpaid,
  type RevenueByPeriodParams,
  type RevenuePeriodParams,
} from './revenue.api';

function periodKey(p: RevenuePeriodParams): string {
  return JSON.stringify([p.from, p.to, p.scope, p.branchIds]);
}

/** Số chỉ tải khi vào trang, đổi bộ lọc/kỳ/phạm vi hoặc bấm "Làm mới" (docs/DECISIONS.md #279): không tự làm mới nền. `enabled=false` khi kỳ tuỳ chọn đang nhập sai. */
function reportOptions(enabled: boolean) {
  return { enabled, staleTime: Infinity, refetchOnWindowFocus: false } as const;
}

export function useRevenueByPeriodQuery(p: RevenueByPeriodParams, enabled: boolean) {
  const { tenantId } = useAppConfig();
  return useQuery({ queryKey: queryKey(tenantId, 'report', 'revenue', 'by-period', periodKey(p), p.groupBy), queryFn: () => getRevenueByPeriod(p), ...reportOptions(enabled) });
}

export function useRevenueByServiceQuery(p: RevenuePeriodParams, enabled: boolean) {
  const { tenantId } = useAppConfig();
  return useQuery({ queryKey: queryKey(tenantId, 'report', 'revenue', 'by-service', periodKey(p)), queryFn: () => getRevenueByService(p), ...reportOptions(enabled) });
}

export function useRevenueByMethodQuery(p: RevenuePeriodParams, enabled: boolean) {
  const { tenantId } = useAppConfig();
  return useQuery({ queryKey: queryKey(tenantId, 'report', 'revenue', 'by-method', periodKey(p)), queryFn: () => getRevenueByMethod(p), ...reportOptions(enabled) });
}

export function useRevenueUnpaidQuery(p: RevenuePeriodParams, enabled: boolean) {
  const { tenantId } = useAppConfig();
  return useQuery({ queryKey: queryKey(tenantId, 'report', 'revenue', 'unpaid', periodKey(p)), queryFn: () => getRevenueUnpaid(p), ...reportOptions(enabled) });
}

export function useRevenueByCashierQuery(p: RevenuePeriodParams, enabled: boolean) {
  const { tenantId } = useAppConfig();
  return useQuery({ queryKey: queryKey(tenantId, 'report', 'revenue', 'by-cashier', periodKey(p)), queryFn: () => getRevenueByCashier(p), ...reportOptions(enabled) });
}
