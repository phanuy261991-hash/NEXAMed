import type {
  ApplyInvoiceDiscountRequest,
  Invoice,
  InvoiceResponse,
  ListBillingInvoicesResponse,
  MarkInvoicePaidRequest,
  PayInvoiceWithWalletRequest,
  RefundInvoiceRequest,
  RevertInvoicePaymentRequest,
  SaveInvoiceDraftRequest,
  TopUpAndPayInvoiceWithWalletRequest,
} from '@nexamed/shared';
import { getApiClient, unwrap } from '../../shared/api/client';

export async function getBillingInvoiceList(date?: string): Promise<ListBillingInvoicesResponse> {
  return unwrap(await getApiClient().GET('/api/v1/billing/invoices', { params: { query: { date } } })) as ListBillingInvoicesResponse;
}

export async function getBillingInvoice(encounterId: string): Promise<InvoiceResponse> {
  return unwrap(
    await getApiClient().GET('/api/v1/billing/invoices/{encounterId}', { params: { path: { encounterId } } }),
  ) as InvoiceResponse;
}

export async function markInvoicePaid(encounterId: string, body: MarkInvoicePaidRequest): Promise<Invoice> {
  return unwrap(
    await getApiClient().POST('/api/v1/billing/invoices/{encounterId}/pay', { params: { path: { encounterId } }, body }),
  ) as Invoice;
}

/** Ví tạm ứng — trừ số dư ví HIỆN CÓ (không nạp thêm). */
export async function payInvoiceWithWallet(encounterId: string, body: PayInvoiceWithWalletRequest): Promise<Invoice> {
  return unwrap(
    await getApiClient().POST('/api/v1/billing/invoices/{encounterId}/pay-with-wallet', { params: { path: { encounterId } }, body }),
  ) as Invoice;
}

/** Ví tạm ứng — nạp thêm vào ví rồi trừ ngay trong 1 lượt (Luồng "Nạp phần thiếu"/"Nạp mức chuẩn"). */
export async function topUpAndPayInvoiceWithWallet(encounterId: string, body: TopUpAndPayInvoiceWithWalletRequest): Promise<Invoice> {
  return unwrap(
    await getApiClient().POST('/api/v1/billing/invoices/{encounterId}/topup-and-pay-with-wallet', { params: { path: { encounterId } }, body }),
  ) as Invoice;
}

export async function revertInvoicePayment(encounterId: string, body: RevertInvoicePaymentRequest): Promise<Invoice> {
  return unwrap(
    await getApiClient().POST('/api/v1/billing/invoices/{encounterId}/revert-payment', { params: { path: { encounterId } }, body }),
  ) as Invoice;
}

/** #085 — HOÀN TIỀN cho lượt khám đã huỷ, quyền riêng `invoice.refund` (không phải mọi vai trò gọi được). */
export async function refundInvoice(encounterId: string, body: RefundInvoiceRequest): Promise<Invoice> {
  return unwrap(
    await getApiClient().POST('/api/v1/billing/invoices/{encounterId}/refund', { params: { path: { encounterId } }, body }),
  ) as Invoice;
}

export async function saveInvoiceDraft(encounterId: string, body: SaveInvoiceDraftRequest): Promise<Invoice> {
  return unwrap(
    await getApiClient().POST('/api/v1/billing/invoices/{encounterId}/save-draft', { params: { path: { encounterId } }, body }),
  ) as Invoice;
}

export async function printInvoice(encounterId: string): Promise<Invoice> {
  return unwrap(
    await getApiClient().POST('/api/v1/billing/invoices/{encounterId}/print', { params: { path: { encounterId } } }),
  ) as Invoice;
}

/** Chiết khấu (Toàn hoá đơn/Từng dịch vụ) — chỉ khi phiếu còn UNPAID, bắt buộc lý do. */
export async function applyInvoiceDiscount(encounterId: string, body: ApplyInvoiceDiscountRequest): Promise<Invoice> {
  return unwrap(
    await getApiClient().POST('/api/v1/billing/invoices/{encounterId}/discount', { params: { path: { encounterId } }, body }),
  ) as Invoice;
}
