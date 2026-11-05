import { useMutation, useQuery } from '@tanstack/react-query';
import type { DailyReportQuery } from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import { exportDailyReport, getDailyReport } from './daily-report.api';

/** Số chỉ tải khi vào trang, đổi ngày/phạm vi hoặc bấm "Làm mới" (docs/DECISIONS.md #279): không tự làm mới nền. */
export function useDailyReportQuery(query: DailyReportQuery) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'report', 'daily', JSON.stringify(query)),
    queryFn: () => getDailyReport(query),
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
}

export function useExportDailyReportMutation() {
  return useMutation({
    mutationFn: ({ query, date }: { query: DailyReportQuery; date: string }) => exportDailyReport(query, date),
  });
}
