import { useQuery } from '@tanstack/react-query';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import { listProvinces, listWards } from './geo.api';

/** Danh mục hành chính read-only (docs/DECISIONS.md #038) — `staleTime: Infinity`, không có mutation nào invalidate. */
export function useProvincesQuery() {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'geo', 'provinces'),
    queryFn: listProvinces,
    staleTime: Infinity,
  });
}

/** Chỉ gọi khi đã chọn Tỉnh (`enabled`) — cascading theo `provinceCode`, dùng trong form. */
export function useWardsQuery(provinceCode: string) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'geo', 'wards', provinceCode),
    queryFn: () => listWards(provinceCode),
    enabled: provinceCode !== '',
    staleTime: Infinity,
  });
}

/**
 * Toàn bộ ~3321 phường/xã, không lọc theo tỉnh — dùng để dựng bảng tra code→tên hiển thị ở màn
 * hình danh sách bệnh nhân (`formatAddressLine`), không dùng cho Combobox trong form (quá nhiều
 * để hiện một lúc, xem `useWardsQuery` cascading ở trên).
 */
export function useAllWardsQuery() {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'geo', 'wards', 'all'),
    queryFn: () => listWards(),
    staleTime: Infinity,
  });
}
