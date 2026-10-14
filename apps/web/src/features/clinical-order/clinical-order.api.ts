import type { GetClinicalOrderResponse, ListClinicalOrdersQuery, ListClinicalOrdersResponse, SaveClinicalOrderRequest } from '@nexamed/shared';
import { getApiClient, unwrap } from '../../shared/api/client';

/** Cận lâm sàng GĐ3 — Chỉ định của bác sĩ (docs/DECISIONS.md #212). */

export async function getClinicalOrder(encounterId: string): Promise<GetClinicalOrderResponse> {
  return unwrap(await getApiClient().GET('/api/v1/encounters/{encounterId}/clinical-orders', { params: { path: { encounterId } } })) as GetClinicalOrderResponse;
}

/** Menu "Phiếu chỉ định" (#232) — sổ phiếu chỉ định của chi nhánh đang làm việc, phân trang cursor. */
export async function listClinicalOrders(query: ListClinicalOrdersQuery): Promise<ListClinicalOrdersResponse> {
  return unwrap(await getApiClient().GET('/api/v1/clinical-orders', { params: { query } })) as ListClinicalOrdersResponse;
}

export async function saveClinicalOrder(encounterId: string, body: SaveClinicalOrderRequest): Promise<GetClinicalOrderResponse> {
  return unwrap(await getApiClient().PUT('/api/v1/encounters/{encounterId}/clinical-orders', { params: { path: { encounterId } }, body })) as GetClinicalOrderResponse;
}

/** Ghi audit mỗi lần in phiếu chỉ định (dữ liệu y tế đưa ra giấy). */
export async function recordClinicalOrderPrint(encounterId: string): Promise<void> {
  unwrap(await getApiClient().POST('/api/v1/encounters/{encounterId}/clinical-orders/print', { params: { path: { encounterId } } }));
}

/** Bác sĩ phụ trách đã mở tab "Kết quả cận lâm sàng" → đánh dấu kết quả đã duyệt là đã xem (#221). Người khác gọi thì server trả `marked: 0`. */
export async function markClinicalOrderResultsSeen(encounterId: string): Promise<{ marked: number }> {
  return unwrap(await getApiClient().POST('/api/v1/encounters/{encounterId}/clinical-orders/results-seen', { params: { path: { encounterId } } })) as { marked: number };
}
