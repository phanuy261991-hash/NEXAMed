import type { CashFlowReportQuery, CashFlowReportResponse } from '@nexamed/shared';
import { downloadFile, getApiClient, unwrap } from '../../shared/api/client';

export async function getCashFlowReport(query: CashFlowReportQuery): Promise<CashFlowReportResponse> {
  return unwrap(await getApiClient().GET('/api/v1/cash-book/cash-flow-report', { params: { query } })) as CashFlowReportResponse;
}

/** Xuất Excel — tải file thô qua `downloadFile()` (fetch trực tiếp), KHÔNG qua client sinh từ
 * OpenAPI (endpoint trả `.xlsx` nhị phân qua `@Res()`, không có envelope `{data,meta}`). */
export async function exportCashFlowReport(query: CashFlowReportQuery): Promise<void> {
  await downloadFile(`/api/v1/cash-book/cash-flow-report/export?from=${query.from}&to=${query.to}`, `bao-cao-dong-tien-${query.from}_${query.to}.xlsx`);
}
