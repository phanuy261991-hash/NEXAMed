import type { PatientDemographicsReport, PatientNewReturningReport, PatientNotReturningReport } from '@nexamed/shared';
import { downloadFile, getApiClient, unwrap } from '../../../shared/api/client';
import { toQueryString, toReportScopeApiQuery } from '../../branch/report-scope';
import type { OperationsPeriodParams } from '../operations/operations.api';

/** Tham số chung của ba báo cáo Bệnh nhân: khoảng ngày + phạm vi chi nhánh. */
export type PatientPeriodParams = OperationsPeriodParams;

function query(p: PatientPeriodParams) {
  return toReportScopeApiQuery({ from: p.from, to: p.to, scope: p.scope, branchIds: p.branchIds });
}

export async function getPatientNewReturning(p: PatientPeriodParams): Promise<PatientNewReturningReport> {
  return unwrap(await getApiClient().GET('/api/v1/reports/patients/new-returning', { params: { query: query(p) } })) as PatientNewReturningReport;
}

export async function getPatientDemographics(p: PatientPeriodParams): Promise<PatientDemographicsReport> {
  return unwrap(await getApiClient().GET('/api/v1/reports/patients/demographics', { params: { query: query(p) } })) as PatientDemographicsReport;
}

export async function getPatientNotReturning(p: PatientPeriodParams): Promise<PatientNotReturningReport> {
  return unwrap(await getApiClient().GET('/api/v1/reports/patients/not-returning', { params: { query: query(p) } })) as PatientNotReturningReport;
}

/** Excel — tải file thô qua `downloadFile()`; xuất ĐÚNG kỳ và phạm vi chi nhánh đang xem (docs/DECISIONS.md #287). */
export type PatientExportKind = 'new-returning' | 'demographics' | 'not-returning';

const EXPORT_FILE_STEM: Record<PatientExportKind, string> = {
  'new-returning': 'benh-nhan-moi-va-cu',
  demographics: 'tuoi-gioi-dia-ban',
  'not-returning': 'benh-nhan-khong-quay-lai',
};

export async function exportPatientExcel(kind: PatientExportKind, p: PatientPeriodParams): Promise<void> {
  await downloadFile(`/api/v1/reports/patients/${kind}/export?${toQueryString(query(p))}`, `${EXPORT_FILE_STEM[kind]}-${p.from}-${p.to}.xlsx`);
}
