import type { ClinicalDiagnosisReport, ClinicalParaclinicalReport } from '@nexamed/shared';
import { downloadFile, getApiClient, unwrap } from '../../../shared/api/client';
import { toQueryString, toReportScopeApiQuery } from '../../branch/report-scope';
import type { OperationsPeriodParams } from '../operations/operations.api';

/** Tham số chung của hai báo cáo Chuyên môn: khoảng ngày + phạm vi chi nhánh. */
export type ClinicalPeriodParams = OperationsPeriodParams;

function query(p: ClinicalPeriodParams) {
  return toReportScopeApiQuery({ from: p.from, to: p.to, scope: p.scope, branchIds: p.branchIds });
}

export async function getClinicalDiagnoses(p: ClinicalPeriodParams): Promise<ClinicalDiagnosisReport> {
  return unwrap(await getApiClient().GET('/api/v1/reports/clinical/diagnoses', { params: { query: query(p) } })) as ClinicalDiagnosisReport;
}

export async function getClinicalParaclinical(p: ClinicalPeriodParams): Promise<ClinicalParaclinicalReport> {
  return unwrap(await getApiClient().GET('/api/v1/reports/clinical/paraclinical', { params: { query: query(p) } })) as ClinicalParaclinicalReport;
}

/** Excel — tải file thô qua `downloadFile()`; xuất ĐÚNG kỳ và phạm vi chi nhánh đang xem (docs/DECISIONS.md #287). */
export type ClinicalExportKind = 'diagnoses' | 'paraclinical';

const EXPORT_FILE_STEM: Record<ClinicalExportKind, string> = {
  diagnoses: 'co-cau-chan-doan-icd10',
  paraclinical: 'can-lam-sang',
};

export async function exportClinicalExcel(kind: ClinicalExportKind, p: ClinicalPeriodParams): Promise<void> {
  await downloadFile(`/api/v1/reports/clinical/${kind}/export?${toQueryString(query(p))}`, `${EXPORT_FILE_STEM[kind]}-${p.from}-${p.to}.xlsx`);
}
