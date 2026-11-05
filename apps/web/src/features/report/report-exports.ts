import { useMutation } from '@tanstack/react-query';
import { downloadFile } from '../../shared/api/client';
import { toQueryString } from '../branch/report-scope';

/**
 * Tải Excel của các báo cáo danh sách (docs/DECISIONS.md #287) — mỗi hàm gửi ĐÚNG bộ lọc đang xem lên máy chủ (không phân trang) và tải tệp thô qua `downloadFile()`
 * (endpoint trả `.xlsx` nhị phân, không qua client sinh từ OpenAPI). Lỗi tải đi qua hộp báo lỗi chung của mutation.
 */
export async function exportWalletsExcel(filters: { q?: string; status?: 'ACTIVE' | 'CLOSED' }): Promise<void> {
  await downloadFile(`/api/v1/wallet/export?${toQueryString({ q: filters.q, status: filters.status })}`, 'vi-tam-ung.xlsx');
}

export async function exportSupplierDebtExcel(filters: { q?: string; showAll: boolean }): Promise<void> {
  await downloadFile(`/api/v1/supplier-debt/summaries/export?${toQueryString({ q: filters.q, showAll: String(filters.showAll) })}`, 'cong-no-nha-cung-cap.xlsx');
}

export async function exportStockBalancesExcel(filters: { warehouseId?: string; q?: string; belowMinOnly: boolean }): Promise<void> {
  await downloadFile(
    `/api/v1/inventory/balances/export?${toQueryString({ warehouseId: filters.warehouseId, q: filters.q, belowMinOnly: String(filters.belowMinOnly) })}`,
    'ton-kho.xlsx',
  );
}

export async function exportAuditLogExcel(filters: { patientId?: string; actorId?: string; from?: string; to?: string }): Promise<void> {
  await downloadFile(`/api/v1/audit-log/export?${toQueryString({ patientId: filters.patientId, actorId: filters.actorId, from: filters.from, to: filters.to })}`, 'nhat-ky-kiem-toan.xlsx');
}

export function useExportWalletsMutation() {
  return useMutation({ mutationFn: exportWalletsExcel });
}
export function useExportSupplierDebtMutation() {
  return useMutation({ mutationFn: exportSupplierDebtExcel });
}
export function useExportStockBalancesMutation() {
  return useMutation({ mutationFn: exportStockBalancesExcel });
}
export function useExportAuditLogMutation() {
  return useMutation({ mutationFn: exportAuditLogExcel });
}
