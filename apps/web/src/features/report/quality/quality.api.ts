import type { QualityIncompleteReport, QualityInteropReport } from '@nexamed/shared';
import { downloadFile, getApiClient, unwrap } from '../../../shared/api/client';
import { toQueryString, toReportScopeApiQuery } from '../../branch/report-scope';
import type { OperationsPeriodParams } from '../operations/operations.api';

/** Tham số chung của hai báo cáo Chất lượng và tuân thủ: khoảng ngày + phạm vi chi nhánh. "Lượt khám chưa hoàn tất" là ảnh chụp đến hôm nay nên CHỈ gửi phạm vi, bỏ khoảng ngày. */
export type QualityPeriodParams = OperationsPeriodParams;

function scopeOnlyQuery(p: QualityPeriodParams) {
  return toReportScopeApiQuery({ scope: p.scope, branchIds: p.branchIds });
}

function periodQuery(p: QualityPeriodParams) {
  return toReportScopeApiQuery({ from: p.from, to: p.to, scope: p.scope, branchIds: p.branchIds });
}

export async function getQualityIncomplete(p: QualityPeriodParams): Promise<QualityIncompleteReport> {
  return unwrap(await getApiClient().GET('/api/v1/reports/quality/incomplete', { params: { query: scopeOnlyQuery(p) } })) as QualityIncompleteReport;
}

export async function getQualityInterop(p: QualityPeriodParams): Promise<QualityInteropReport> {
  return unwrap(await getApiClient().GET('/api/v1/reports/quality/interop', { params: { query: periodQuery(p) } })) as QualityInteropReport;
}

/** Excel — tải file thô qua `downloadFile()`; xuất ĐÚNG phạm vi chi nhánh (và kỳ, với liên thông) đang xem (docs/DECISIONS.md #287). */
export type QualityExportKind = 'incomplete' | 'interop';

export async function exportQualityExcel(kind: QualityExportKind, p: QualityPeriodParams): Promise<void> {
  if (kind === 'incomplete') {
    await downloadFile(`/api/v1/reports/quality/incomplete/export?${toQueryString(scopeOnlyQuery(p))}`, 'luot-kham-chua-hoan-tat.xlsx');
    return;
  }
  await downloadFile(`/api/v1/reports/quality/interop/export?${toQueryString(periodQuery(p))}`, `lien-thong-don-thuoc-${p.from}-${p.to}.xlsx`);
}
