import type {
  ApproveCashVoucherRequest,
  CashVoucher,
  CreateCashVoucherRequest,
  ListCashVouchersQuery,
  ListCashVouchersResponse,
  RejectCashVoucherRequest,
  UpdateCashVoucherRequest,
  VoidCashVoucherRequest,
} from '@nexamed/shared';
import { downloadFile, getApiClient, unwrap } from '../../shared/api/client';

export async function getCashVouchers(query: ListCashVouchersQuery): Promise<ListCashVouchersResponse> {
  return unwrap(await getApiClient().GET('/api/v1/cash-vouchers', { params: { query } })) as ListCashVouchersResponse;
}

/** Xuất Excel — endpoint đặt ở module `cash-book-report` (`GET /cash-book/vouchers/export`, đúng
 * bộ lọc đang xem), tải file thô qua `downloadFile()`, đúng khuôn `cash-flow-report.api.ts`. */
export async function exportCashVouchers(query: ListCashVouchersQuery): Promise<void> {
  const params = new URLSearchParams();
  if (query.from) params.set('from', query.from);
  if (query.to) params.set('to', query.to);
  if (query.direction) params.set('direction', query.direction);
  if (query.status) params.set('status', query.status);
  const from = query.from ?? 'tat-ca';
  const to = query.to ?? 'tat-ca';
  await downloadFile(`/api/v1/cash-book/vouchers/export?${params.toString()}`, `phieu-thu-chi-${from}_${to}.xlsx`);
}

export async function getCashVoucher(id: string): Promise<CashVoucher> {
  return unwrap(await getApiClient().GET('/api/v1/cash-vouchers/{id}', { params: { path: { id } } })) as CashVoucher;
}

export async function createCashVoucher(body: CreateCashVoucherRequest): Promise<CashVoucher> {
  return unwrap(await getApiClient().POST('/api/v1/cash-vouchers', { body })) as CashVoucher;
}

export async function updateCashVoucher(id: string, body: UpdateCashVoucherRequest): Promise<CashVoucher> {
  return unwrap(await getApiClient().PATCH('/api/v1/cash-vouchers/{id}', { params: { path: { id } }, body })) as CashVoucher;
}

export async function voidCashVoucher(id: string, body: VoidCashVoucherRequest): Promise<CashVoucher> {
  return unwrap(await getApiClient().POST('/api/v1/cash-vouchers/{id}/void', { params: { path: { id } }, body })) as CashVoucher;
}

export async function approveCashVoucher(id: string, body: ApproveCashVoucherRequest): Promise<CashVoucher> {
  return unwrap(await getApiClient().POST('/api/v1/cash-vouchers/{id}/approve', { params: { path: { id } }, body })) as CashVoucher;
}

export async function rejectCashVoucher(id: string, body: RejectCashVoucherRequest): Promise<CashVoucher> {
  return unwrap(await getApiClient().POST('/api/v1/cash-vouchers/{id}/reject', { params: { path: { id } }, body })) as CashVoucher;
}

export async function printCashVoucher(id: string): Promise<CashVoucher> {
  return unwrap(await getApiClient().POST('/api/v1/cash-vouchers/{id}/print', { params: { path: { id } } })) as CashVoucher;
}
