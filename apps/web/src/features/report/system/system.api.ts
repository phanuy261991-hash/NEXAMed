import type { SystemCrossReport, SystemMonthlyReport, SystemOverviewReport, SystemRankingReport } from '@nexamed/shared';
import { downloadFile, getApiClient, unwrap } from '../../../shared/api/client';
import { toQueryString, toReportScopeApiQuery } from '../../branch/report-scope';
import type { OperationsPeriodParams } from '../operations/operations.api';

/** Tham số của tab Tổng hợp tháng: tháng `YYYY-MM` + phạm vi chi nhánh (`from`/`to` là khoảng ngày của tháng, máy chủ dùng `month`). */
export interface SystemMonthlyParams extends OperationsPeriodParams {
  month?: string;
}

function query(p: OperationsPeriodParams) {
  return toReportScopeApiQuery({ from: p.from, to: p.to, scope: p.scope, branchIds: p.branchIds });
}

function monthlyQuery(p: SystemMonthlyParams) {
  return toReportScopeApiQuery({ from: p.from, to: p.to, scope: p.scope, branchIds: p.branchIds, month: p.month ?? p.from.slice(0, 7) });
}

export async function getSystemOverview(p: OperationsPeriodParams): Promise<SystemOverviewReport> {
  return unwrap(await getApiClient().GET('/api/v1/reports/system/overview', { params: { query: query(p) } })) as SystemOverviewReport;
}

export async function getSystemRanking(p: OperationsPeriodParams): Promise<SystemRankingReport> {
  return unwrap(await getApiClient().GET('/api/v1/reports/system/ranking', { params: { query: query(p) } })) as SystemRankingReport;
}

export async function getSystemMonthly(p: SystemMonthlyParams): Promise<SystemMonthlyReport> {
  return unwrap(await getApiClient().GET('/api/v1/reports/system/monthly', { params: { query: monthlyQuery(p) } })) as SystemMonthlyReport;
}

export async function getSystemCross(p: OperationsPeriodParams): Promise<SystemCrossReport> {
  return unwrap(await getApiClient().GET('/api/v1/reports/system/cross', { params: { query: query(p) } })) as SystemCrossReport;
}

/** Excel — tải file thô qua `downloadFile()`; xuất ĐÚNG kỳ và phạm vi chi nhánh đang xem (docs/DECISIONS.md #287). */
export type SystemExportKind = 'overview' | 'ranking' | 'monthly' | 'cross';

const EXPORT_FILE_STEM: Record<SystemExportKind, string> = {
  overview: 'toan-he-thong-so-sanh-chi-nhanh',
  ranking: 'toan-he-thong-xep-hang',
  monthly: 'toan-he-thong-tong-hop-thang',
  cross: 'toan-he-thong-kham-cheo-chi-nhanh',
};

export async function exportSystemExcel(kind: SystemExportKind, p: SystemMonthlyParams): Promise<void> {
  const q = kind === 'monthly' ? monthlyQuery(p) : query(p);
  await downloadFile(`/api/v1/reports/system/${kind}/export?${toQueryString(q)}`, `${EXPORT_FILE_STEM[kind]}-${p.from}-${p.to}.xlsx`);
}
