import type { PharmacyControlledReport, PharmacyDispensedReport, PharmacyMarginReport } from '@nexamed/shared';
import { downloadFile, getApiClient, unwrap } from '../../../shared/api/client';
import { toQueryString, toReportScopeApiQuery } from '../../branch/report-scope';
import type { OperationsPeriodParams } from '../operations/operations.api';
import type { ControlledTypeFilter, PharmacyItemFilter } from './pharmacy-model';

/** Tham số của hai báo cáo Đã phát và Lãi gộp: khoảng ngày + phạm vi chi nhánh + Loại (thuốc / vật tư). */
export interface PharmacyPeriodParams extends OperationsPeriodParams {
  itemType?: PharmacyItemFilter;
}

/** Tham số của báo cáo Kiểm soát đặc biệt: khoảng ngày + phạm vi chi nhánh + Phân loại. */
export interface ControlledPeriodParams extends OperationsPeriodParams {
  controlType?: ControlledTypeFilter;
}

function query(p: PharmacyPeriodParams) {
  return toReportScopeApiQuery({ from: p.from, to: p.to, scope: p.scope, branchIds: p.branchIds, ...(p.itemType ? { itemType: p.itemType } : {}) });
}

function controlledQuery(p: ControlledPeriodParams) {
  return toReportScopeApiQuery({ from: p.from, to: p.to, scope: p.scope, branchIds: p.branchIds, ...(p.controlType ? { controlType: p.controlType } : {}) });
}

export async function getPharmacyDispensed(p: PharmacyPeriodParams): Promise<PharmacyDispensedReport> {
  return unwrap(await getApiClient().GET('/api/v1/reports/pharmacy/dispensed', { params: { query: query(p) } })) as PharmacyDispensedReport;
}

export async function getPharmacyMargin(p: PharmacyPeriodParams): Promise<PharmacyMarginReport> {
  return unwrap(await getApiClient().GET('/api/v1/reports/pharmacy/margin', { params: { query: query(p) } })) as PharmacyMarginReport;
}

export async function getPharmacyControlled(p: ControlledPeriodParams): Promise<PharmacyControlledReport> {
  return unwrap(await getApiClient().GET('/api/v1/reports/pharmacy/controlled', { params: { query: controlledQuery(p) } })) as PharmacyControlledReport;
}

/** Excel — tải file thô qua `downloadFile()`; xuất ĐÚNG kỳ, Loại và phạm vi chi nhánh đang xem (docs/DECISIONS.md #287). */
export async function exportPharmacyExcel(kind: 'dispensed' | 'margin', p: PharmacyPeriodParams): Promise<void> {
  const stem = kind === 'dispensed' ? 'thuoc-vat-tu-da-phat' : 'lai-gop-thuoc-vat-tu';
  await downloadFile(`/api/v1/reports/pharmacy/${kind}/export?${toQueryString(query(p))}`, `${stem}-${p.from}-${p.to}.xlsx`);
}

export async function exportControlledExcel(p: ControlledPeriodParams): Promise<void> {
  await downloadFile(`/api/v1/reports/pharmacy/controlled/export?${toQueryString(controlledQuery(p))}`, `thuoc-kiem-soat-dac-biet-${p.from}-${p.to}.xlsx`);
}
