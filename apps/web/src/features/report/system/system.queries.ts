import { useQuery } from '@tanstack/react-query';
import { useAppConfig } from '../../../app/AppConfigProvider';
import { queryKey } from '../../../shared/api/query-keys';
import type { OperationsPeriodParams } from '../operations/operations.api';
import { getSystemCross, getSystemMonthly, getSystemOverview, getSystemRanking, type SystemMonthlyParams } from './system.api';

function periodKey(p: OperationsPeriodParams): string {
  return JSON.stringify([p.from, p.to, p.scope, p.branchIds]);
}

/** Số chỉ tải khi vào trang, đổi bộ lọc/kỳ/phạm vi hoặc bấm "Làm mới" (docs/DECISIONS.md #279): không tự làm mới nền. `enabled=false` khi kỳ tuỳ chọn đang nhập sai. */
function reportOptions(enabled: boolean) {
  return { enabled, staleTime: Infinity, refetchOnWindowFocus: false } as const;
}

export function useSystemOverviewQuery(p: OperationsPeriodParams, enabled: boolean) {
  const { tenantId } = useAppConfig();
  return useQuery({ queryKey: queryKey(tenantId, 'report', 'system', 'overview', periodKey(p)), queryFn: () => getSystemOverview(p), ...reportOptions(enabled) });
}

export function useSystemRankingQuery(p: OperationsPeriodParams, enabled: boolean) {
  const { tenantId } = useAppConfig();
  return useQuery({ queryKey: queryKey(tenantId, 'report', 'system', 'ranking', periodKey(p)), queryFn: () => getSystemRanking(p), ...reportOptions(enabled) });
}

export function useSystemMonthlyQuery(p: SystemMonthlyParams, enabled: boolean) {
  const { tenantId } = useAppConfig();
  return useQuery({ queryKey: queryKey(tenantId, 'report', 'system', 'monthly', periodKey(p), p.month ?? ''), queryFn: () => getSystemMonthly(p), ...reportOptions(enabled) });
}

export function useSystemCrossQuery(p: OperationsPeriodParams, enabled: boolean) {
  const { tenantId } = useAppConfig();
  return useQuery({ queryKey: queryKey(tenantId, 'report', 'system', 'cross', periodKey(p)), queryFn: () => getSystemCross(p), ...reportOptions(enabled) });
}
