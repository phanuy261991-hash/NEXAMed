import type {
  ApproveCashierShiftRequest,
  CashierShiftDetail,
  CashierShiftSummary,
  CloseCashierShiftRequest,
  CurrentCashierShiftResponse,
  EditCashierShiftRequest,
  ListCashierShiftsQuery,
  ListCashierShiftsResponse,
  OpenCashierShiftRequest,
  ResolveCashierShiftDiscrepancyRequest,
} from '@nexamed/shared';
import { getApiClient, unwrap } from '../../shared/api/client';

export async function getCurrentCashierShift(): Promise<CurrentCashierShiftResponse> {
  return unwrap(await getApiClient().GET('/api/v1/cashier-shifts/current', {})) as CurrentCashierShiftResponse;
}

export async function openCashierShift(body: OpenCashierShiftRequest): Promise<CashierShiftDetail> {
  return unwrap(await getApiClient().POST('/api/v1/cashier-shifts/open', { body })) as CashierShiftDetail;
}

export async function getCashierShiftSummary(id: string): Promise<CashierShiftSummary> {
  return unwrap(await getApiClient().GET('/api/v1/cashier-shifts/{id}/summary', { params: { path: { id } } })) as CashierShiftSummary;
}

export async function closeCashierShift(id: string, body: CloseCashierShiftRequest): Promise<CashierShiftDetail> {
  return unwrap(await getApiClient().POST('/api/v1/cashier-shifts/{id}/close', { params: { path: { id } }, body })) as CashierShiftDetail;
}

export async function getCashierShiftList(query: ListCashierShiftsQuery): Promise<ListCashierShiftsResponse> {
  return unwrap(await getApiClient().GET('/api/v1/cashier-shifts', { params: { query } })) as ListCashierShiftsResponse;
}

export async function getCashierShiftDetail(id: string): Promise<CashierShiftDetail> {
  return unwrap(await getApiClient().GET('/api/v1/cashier-shifts/{id}', { params: { path: { id } } })) as CashierShiftDetail;
}

export async function getCashierShiftResyncPreview(id: string): Promise<CashierShiftSummary> {
  return unwrap(await getApiClient().GET('/api/v1/cashier-shifts/{id}/resync-preview', { params: { path: { id } } })) as CashierShiftSummary;
}

export async function resolveCashierShiftDiscrepancy(id: string, body: ResolveCashierShiftDiscrepancyRequest): Promise<CashierShiftDetail> {
  return unwrap(
    await getApiClient().POST('/api/v1/cashier-shifts/{id}/resolve-discrepancy', { params: { path: { id } }, body }),
  ) as CashierShiftDetail;
}

export async function approveCashierShift(id: string, body: ApproveCashierShiftRequest): Promise<CashierShiftDetail> {
  return unwrap(await getApiClient().POST('/api/v1/cashier-shifts/{id}/approve', { params: { path: { id } }, body })) as CashierShiftDetail;
}

export async function editCashierShift(id: string, body: EditCashierShiftRequest): Promise<CashierShiftDetail> {
  return unwrap(await getApiClient().POST('/api/v1/cashier-shifts/{id}/edit', { params: { path: { id } }, body })) as CashierShiftDetail;
}

export async function getCashierShiftBlindCloseEnabled(): Promise<boolean> {
  const res = (await unwrap(await getApiClient().GET('/api/v1/clinic-settings/cashier-shift-blind-close-enabled', {}))) as { enabled: boolean };
  return res.enabled;
}
