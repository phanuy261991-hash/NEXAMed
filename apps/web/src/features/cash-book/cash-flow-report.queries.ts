import { useMutation, useQuery } from '@tanstack/react-query';
import type { CashFlowReportQuery } from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import { exportCashFlowReport, getCashFlowReport } from './cash-flow-report.api';

export function useCashFlowReportQuery(query: CashFlowReportQuery) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'cash-flow-report', JSON.stringify(query)),
    queryFn: () => getCashFlowReport(query),
  });
}

export function useExportCashFlowReportMutation() {
  return useMutation({
    mutationFn: (query: CashFlowReportQuery) => exportCashFlowReport(query),
  });
}
