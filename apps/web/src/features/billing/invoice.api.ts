import type {
  Invoice,
  InvoiceResponse,
  ListBillingInvoicesResponse,
  MarkInvoicePaidRequest,
  RevertInvoicePaymentRequest,
  SaveInvoiceDraftRequest,
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

export async function revertInvoicePayment(encounterId: string, body: RevertInvoicePaymentRequest): Promise<Invoice> {
  return unwrap(
    await getApiClient().POST('/api/v1/billing/invoices/{encounterId}/revert-payment', { params: { path: { encounterId } }, body }),
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
