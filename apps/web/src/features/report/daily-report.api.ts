import type { DailyReport, DailyReportQuery } from '@nexamed/shared';
import { downloadFile, getApiClient, unwrap } from '../../shared/api/client';
import { toQueryString, toReportScopeApiQuery } from '../branch/report-scope';

export async function getDailyReport(query: DailyReportQuery): Promise<DailyReport> {
  return unwrap(await getApiClient().GET('/api/v1/reports/daily', { params: { query: toReportScopeApiQuery(query) } })) as DailyReport;
}

/** Xuất Excel — tải file thô qua `downloadFile()`; xuất ĐÚNG ngày và phạm vi chi nhánh đang xem (docs/DECISIONS.md #287). */
export async function exportDailyReport(query: DailyReportQuery, date: string): Promise<void> {
  await downloadFile(`/api/v1/reports/daily/export?${toQueryString(toReportScopeApiQuery(query))}`, `bao-cao-ngay-${date}.xlsx`);
}
