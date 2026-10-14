import { useQuery } from '@tanstack/react-query';
import type { ClinicPrintHeader } from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { getApiClient, unwrap } from '../api/client';
import { queryKey } from '../api/query-keys';
import { STALE_REFERENCE_MS } from '../api/stale-time';

/** Tự-phục vụ (Thu ngân/Kê đơn/Kho) — không cần `clinic_config.read` (đúng khuôn `getDeferredPaymentStatus`). */
async function getClinicPrintHeader(branchId: string | null | undefined): Promise<ClinicPrintHeader> {
  return unwrap(await getApiClient().GET('/api/v1/clinic-profile/print-header', { params: { query: branchId ? { branchId } : {} } })) as ClinicPrintHeader;
}

/**
 * Đầu trang bản in (tên/địa chỉ/SĐT/MST/logo in). Đặt ở `shared/print` vì `PrintDocument` tự đọc — các chứng từ không
 * còn truyền `clinicHeader` qua props. Khoá `[tenantId, 'clinic', 'print-header']` giữ nguyên để trang "Thông tin
 * phòng khám" invalidate đúng như trước khi sửa tên/logo (khoá có thêm phần đuôi `branchId` nên invalidate theo tiền tố vẫn trúng).
 *
 * Đợt 2 chi nhánh (docs/DECISIONS.md #233): `branchId` = chi nhánh CỦA CHỨNG TỪ (đầu phiếu in tên/địa chỉ/SĐT chi nhánh đó); bỏ trống = chi nhánh
 * đang làm việc (đúng cho mọi chứng từ chỉ mở được trong chi nhánh hiện hành — hoá đơn, phiếu quỹ, phiếu kho...). Chỉ phiếu điều chuyển cần
 * truyền chi nhánh GỬI.
 */
export function useClinicPrintHeaderQuery(branchId?: string | null) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'clinic', 'print-header', branchId ?? undefined),
    queryFn: () => getClinicPrintHeader(branchId),
    staleTime: STALE_REFERENCE_MS,
  });
}
