import { useQuery } from '@tanstack/react-query';
import type { ClinicPrintHeader } from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { getApiClient, unwrap } from '../api/client';
import { queryKey } from '../api/query-keys';
import { STALE_REFERENCE_MS } from '../api/stale-time';

/** Tự-phục vụ (Thu ngân/Kê đơn/Kho) — không cần `clinic_config.read` (đúng khuôn `getDeferredPaymentStatus`). */
async function getClinicPrintHeader(): Promise<ClinicPrintHeader> {
  return unwrap(await getApiClient().GET('/api/v1/clinic-profile/print-header')) as ClinicPrintHeader;
}

/**
 * Đầu trang bản in (tên/địa chỉ/SĐT/MST/logo in). Đặt ở `shared/print` vì `PrintDocument` tự đọc — các chứng từ không
 * còn truyền `clinicHeader` qua props. Khoá `[tenantId, 'clinic', 'print-header']` giữ nguyên để trang "Thông tin
 * phòng khám" invalidate đúng như trước khi sửa tên/logo.
 */
export function useClinicPrintHeaderQuery() {
  const { tenantId } = useAppConfig();
  return useQuery({ queryKey: queryKey(tenantId, 'clinic', 'print-header'), queryFn: getClinicPrintHeader, staleTime: STALE_REFERENCE_MS });
}
