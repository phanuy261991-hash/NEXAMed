import type { DoctorHoursReport, DoctorOrderMixReport, DoctorPerformanceReport } from '@nexamed/shared';
import { downloadFile, getApiClient, unwrap } from '../../../shared/api/client';
import { toQueryString, toReportScopeApiQuery } from '../../branch/report-scope';
import type { OperationsPeriodParams } from '../operations/operations.api';

/** Tham số chung của ba báo cáo Bác sĩ: khoảng ngày + phạm vi chi nhánh + Khoa (rỗng/không có = mọi Khoa). */
export interface DoctorPeriodParams extends OperationsPeriodParams {
  departmentId?: string;
}

function query(p: DoctorPeriodParams) {
  return toReportScopeApiQuery({ from: p.from, to: p.to, scope: p.scope, branchIds: p.branchIds, ...(p.departmentId ? { departmentId: p.departmentId } : {}) });
}

export async function getDoctorPerformance(p: DoctorPeriodParams): Promise<DoctorPerformanceReport> {
  return unwrap(await getApiClient().GET('/api/v1/reports/doctors/performance', { params: { query: query(p) } })) as DoctorPerformanceReport;
}

export async function getDoctorOrderMix(p: DoctorPeriodParams): Promise<DoctorOrderMixReport> {
  return unwrap(await getApiClient().GET('/api/v1/reports/doctors/order-mix', { params: { query: query(p) } })) as DoctorOrderMixReport;
}

export async function getDoctorHours(p: DoctorPeriodParams): Promise<DoctorHoursReport> {
  return unwrap(await getApiClient().GET('/api/v1/reports/doctors/hours', { params: { query: query(p) } })) as DoctorHoursReport;
}

/** Excel — tải file thô qua `downloadFile()`; xuất ĐÚNG kỳ, Khoa và phạm vi chi nhánh đang xem (docs/DECISIONS.md #287). */
export type DoctorExportKind = 'performance' | 'order-mix' | 'hours';

const EXPORT_FILE_STEM: Record<DoctorExportKind, string> = {
  performance: 'hieu-suat-bac-si',
  'order-mix': 'co-cau-ke-don-chi-dinh',
  hours: 'gio-lam-viec-luot-kham',
};

export async function exportDoctorExcel(kind: DoctorExportKind, p: DoctorPeriodParams): Promise<void> {
  await downloadFile(`/api/v1/reports/doctors/${kind}/export?${toQueryString(query(p))}`, `${EXPORT_FILE_STEM[kind]}-${p.from}-${p.to}.xlsx`);
}
