import type { BookingSourceReport, CancellationReport, FollowUpReport, PeakHoursReport, ReportScopeSelection, VisitBookResponse, WaitingReport } from '@nexamed/shared';
import { downloadFile, getApiClient, unwrap } from '../../../shared/api/client';
import { toQueryString, toReportScopeApiQuery } from '../../branch/report-scope';

/** Tham số chung của các báo cáo tổng hợp theo kỳ: khoảng ngày + phạm vi chi nhánh. */
export interface OperationsPeriodParams extends ReportScopeSelection {
  from: string;
  to: string;
}

export interface VisitBookParams extends OperationsPeriodParams {
  doctorId: string;
  icd10Code: string;
  q: string;
}

function periodQuery(p: OperationsPeriodParams) {
  return toReportScopeApiQuery({ from: p.from, to: p.to, scope: p.scope, branchIds: p.branchIds });
}

function visitBookFilter(p: VisitBookParams) {
  return {
    ...periodQuery(p),
    ...(p.doctorId !== '' ? { doctorId: p.doctorId } : {}),
    ...(p.icd10Code.trim() !== '' ? { icd10Code: p.icd10Code.trim() } : {}),
    ...(p.q.trim() !== '' ? { q: p.q.trim() } : {}),
  };
}

export async function getVisitBook(p: VisitBookParams & { cursor?: string; limit?: number }): Promise<VisitBookResponse> {
  const query = { ...visitBookFilter(p), ...(p.cursor ? { cursor: p.cursor } : {}), ...(p.limit ? { limit: p.limit } : {}) };
  return unwrap(await getApiClient().GET('/api/v1/reports/operations/visit-book', { params: { query } })) as VisitBookResponse;
}

export async function getPeakHours(p: OperationsPeriodParams): Promise<PeakHoursReport> {
  return unwrap(await getApiClient().GET('/api/v1/reports/operations/peak-hours', { params: { query: periodQuery(p) } })) as PeakHoursReport;
}

export async function getWaiting(p: OperationsPeriodParams): Promise<WaitingReport> {
  return unwrap(await getApiClient().GET('/api/v1/reports/operations/waiting', { params: { query: periodQuery(p) } })) as WaitingReport;
}

export async function getCancellations(p: OperationsPeriodParams): Promise<CancellationReport> {
  return unwrap(await getApiClient().GET('/api/v1/reports/operations/cancellations', { params: { query: periodQuery(p) } })) as CancellationReport;
}

export async function getFollowUps(p: OperationsPeriodParams): Promise<FollowUpReport> {
  return unwrap(await getApiClient().GET('/api/v1/reports/operations/follow-ups', { params: { query: periodQuery(p) } })) as FollowUpReport;
}

export async function getBookingSources(p: OperationsPeriodParams): Promise<BookingSourceReport> {
  return unwrap(await getApiClient().GET('/api/v1/reports/operations/booking-sources', { params: { query: periodQuery(p) } })) as BookingSourceReport;
}

/** Excel — tải file thô qua `downloadFile()`; xuất ĐÚNG bộ lọc và phạm vi chi nhánh đang xem (docs/DECISIONS.md #287). */
export type OperationsExportKind = 'peak-hours' | 'waiting' | 'cancellations' | 'follow-ups' | 'booking-sources';

const EXPORT_FILE_STEM: Record<OperationsExportKind, string> = {
  'peak-hours': 'gio-cao-diem',
  waiting: 'thoi-gian-cho',
  cancellations: 'huy-va-khong-den',
  'follow-ups': 'tai-kham',
  'booking-sources': 'nguon-dat-lich',
};

export async function exportOperationsExcel(kind: OperationsExportKind, p: OperationsPeriodParams): Promise<void> {
  await downloadFile(`/api/v1/reports/operations/${kind}/export?${toQueryString(periodQuery(p))}`, `${EXPORT_FILE_STEM[kind]}-${p.from}-${p.to}.xlsx`);
}

export async function exportVisitBookExcel(p: VisitBookParams): Promise<void> {
  await downloadFile(`/api/v1/reports/operations/visit-book/export?${toQueryString(visitBookFilter(p))}`, `so-kham-benh-${p.from}-${p.to}.xlsx`);
}
