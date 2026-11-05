import type {
  ReportScopeSelection,
  RevenueByCashierReport,
  RevenueByMethodReport,
  RevenueByPeriodReport,
  RevenueByServiceReport,
  RevenueGroupByCode,
  RevenueUnpaidReport,
} from '@nexamed/shared';
import { downloadFile, getApiClient, unwrap } from '../../../shared/api/client';
import { toQueryString, toReportScopeApiQuery } from '../../branch/report-scope';
import type { OperationsPeriodParams } from '../operations/operations.api';

/** Tham số chung của mọi báo cáo Doanh thu: khoảng ngày + phạm vi chi nhánh (cùng kiểu với nhóm vận hành). */
export type RevenuePeriodParams = OperationsPeriodParams;

export interface RevenueByPeriodParams extends RevenuePeriodParams {
  groupBy: RevenueGroupByCode;
}

function periodQuery(p: RevenuePeriodParams & Partial<Pick<RevenueByPeriodParams, 'groupBy'>> & ReportScopeSelection) {
  return toReportScopeApiQuery({ from: p.from, to: p.to, scope: p.scope, branchIds: p.branchIds, ...(p.groupBy ? { groupBy: p.groupBy } : {}) });
}

export async function getRevenueByPeriod(p: RevenueByPeriodParams): Promise<RevenueByPeriodReport> {
  return unwrap(await getApiClient().GET('/api/v1/reports/revenue/by-period', { params: { query: periodQuery(p) } })) as RevenueByPeriodReport;
}

export async function getRevenueByService(p: RevenuePeriodParams): Promise<RevenueByServiceReport> {
  return unwrap(await getApiClient().GET('/api/v1/reports/revenue/by-service', { params: { query: periodQuery(p) } })) as RevenueByServiceReport;
}

export async function getRevenueByMethod(p: RevenuePeriodParams): Promise<RevenueByMethodReport> {
  return unwrap(await getApiClient().GET('/api/v1/reports/revenue/by-method', { params: { query: periodQuery(p) } })) as RevenueByMethodReport;
}

export async function getRevenueUnpaid(p: RevenuePeriodParams): Promise<RevenueUnpaidReport> {
  return unwrap(await getApiClient().GET('/api/v1/reports/revenue/unpaid', { params: { query: periodQuery(p) } })) as RevenueUnpaidReport;
}

export async function getRevenueByCashier(p: RevenuePeriodParams): Promise<RevenueByCashierReport> {
  return unwrap(await getApiClient().GET('/api/v1/reports/revenue/by-cashier', { params: { query: periodQuery(p) } })) as RevenueByCashierReport;
}

/** Excel — tải file thô qua `downloadFile()`; xuất ĐÚNG kỳ, kiểu gom và phạm vi chi nhánh đang xem (docs/DECISIONS.md #287). */
export type RevenueExportKind = 'by-period' | 'by-service' | 'by-method' | 'unpaid' | 'by-cashier';

const EXPORT_FILE_STEM: Record<RevenueExportKind, string> = {
  'by-period': 'doanh-thu-theo-ky',
  'by-service': 'doanh-thu-theo-dich-vu',
  'by-method': 'doanh-thu-theo-phuong-thuc',
  unpaid: 'phieu-chua-thu',
  'by-cashier': 'doanh-thu-theo-thu-ngan',
};

export async function exportRevenueExcel(kind: RevenueExportKind, p: RevenuePeriodParams & Partial<Pick<RevenueByPeriodParams, 'groupBy'>>): Promise<void> {
  await downloadFile(`/api/v1/reports/revenue/${kind}/export?${toQueryString(periodQuery(p))}`, `${EXPORT_FILE_STEM[kind]}-${p.from}-${p.to}.xlsx`);
}
