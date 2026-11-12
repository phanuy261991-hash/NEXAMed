import type { ServiceConsumptionByCustomerReport, ServiceConsumptionByServiceReport } from '@nexamed/shared';
import { downloadFile, getApiClient, unwrap } from '../../../shared/api/client';
import { toQueryString, toReportScopeApiQuery } from '../../branch/report-scope';
import type { OperationsPeriodParams } from '../operations/operations.api';

/** Tham số của hai tab: khoảng ngày + phạm vi chi nhánh + Dịch vụ + Bác sĩ (bỏ trống = tất cả). */
export interface ServiceConsumptionPeriodParams extends OperationsPeriodParams {
  serviceKey?: string;
  doctorId?: string;
}

function query(p: ServiceConsumptionPeriodParams) {
  return toReportScopeApiQuery({
    from: p.from,
    to: p.to,
    scope: p.scope,
    branchIds: p.branchIds,
    ...(p.serviceKey ? { serviceKey: p.serviceKey } : {}),
    ...(p.doctorId ? { doctorId: p.doctorId } : {}),
  });
}

export async function getServiceConsumptionByService(p: ServiceConsumptionPeriodParams): Promise<ServiceConsumptionByServiceReport> {
  return unwrap(await getApiClient().GET('/api/v1/reports/service-consumption/by-service', { params: { query: query(p) } })) as ServiceConsumptionByServiceReport;
}

export async function getServiceConsumptionByCustomer(p: ServiceConsumptionPeriodParams): Promise<ServiceConsumptionByCustomerReport> {
  return unwrap(await getApiClient().GET('/api/v1/reports/service-consumption/by-customer', { params: { query: query(p) } })) as ServiceConsumptionByCustomerReport;
}

/** Excel — tải file thô qua `downloadFile()`; xuất ĐÚNG kỳ, bộ lọc và phạm vi chi nhánh đang xem (docs/DECISIONS.md #287). */
export async function exportServiceConsumptionExcel(kind: 'by-service' | 'by-customer', p: ServiceConsumptionPeriodParams): Promise<void> {
  const stem = kind === 'by-service' ? 'chi-phi-vat-tu-theo-dich-vu' : 'chi-phi-vat-tu-theo-khach';
  await downloadFile(`/api/v1/reports/service-consumption/${kind}/export?${toQueryString(query(p))}`, `${stem}-${p.from}-${p.to}.xlsx`);
}
