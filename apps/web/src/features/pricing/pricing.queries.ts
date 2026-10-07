import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreatePriceListRequest,
  CreateServicePackageRequest,
  LookupPriceQuery,
  PriceListItemKind,
  PriceListStatus,
  ResolvePriceItem,
  UpdatePriceListRequest,
  UpdateServicePackageRequest,
} from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import {
  createPriceList,
  createServicePackage,
  getPriceList,
  getServicePackage,
  listPriceLists,
  listServicePackages,
  lookupPrice,
  resolvePrices,
  searchPriceableItems,
  updatePriceList,
  updateServicePackage,
  listPriceableGroups,
} from './pricing.api';

/** Cận lâm sàng GĐ2 — Gói dịch vụ + Bảng giá có thời hạn (docs/DECISIONS.md #212). Mọi truy vấn lấy dữ liệu MỚI khi mở màn quản trị. */

export function useServicePackagesQuery(params: { search?: string; includeInactive?: boolean; orderableOnly?: boolean }) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'service-package', 'list', JSON.stringify(params)),
    queryFn: () => listServicePackages(params),
  });
}

export function useServicePackageQuery(id: string | null) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'service-package', 'detail', id ?? undefined),
    queryFn: () => getServicePackage(id!),
    enabled: id !== null,
  });
}

export function usePriceListsQuery(params: { status?: PriceListStatus; search?: string }) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'price-list', 'list', JSON.stringify(params)),
    queryFn: () => listPriceLists(params),
  });
}

export function usePriceListQuery(id: string | null) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'price-list', 'detail', id ?? undefined),
    queryFn: () => getPriceList(id!),
    enabled: id !== null,
  });
}

/** Các nhóm mặt hàng cho hộp thoại "Thêm theo nhóm" — chỉ tải khi hộp thoại mở. */
export function usePriceableGroupsQuery(enabled: boolean) {
  const { tenantId } = useAppConfig();
  return useQuery({ queryKey: queryKey(tenantId, 'price-list', 'groups'), queryFn: listPriceableGroups, enabled });
}

/** Tìm mặt hàng để thêm vào bảng giá/tra thử giá — gọi khi người dùng đã gõ (không tải trước). */
export function usePriceableItemSearch(q: string, kind: PriceListItemKind | undefined) {
  const { tenantId } = useAppConfig();
  const term = q.trim();
  return useQuery({
    queryKey: queryKey(tenantId, 'price-list', 'item-search', term, kind ?? 'all'),
    queryFn: () => searchPriceableItems({ q: term, kind, limit: 20 }),
    enabled: term.length >= 1,
  });
}

/**
 * Giá ÁP DỤNG của 1 mặt hàng vào `date` (ngày tiếp nhận/lập phiếu) sau bảng giá có thời hạn — Tiếp nhận dùng để xem trước đơn giá
 * của Dịch vụ khám. Truyền `null` thì không gọi. Lỗi (không có quyền tra bảng giá/mất mạng) KHÔNG chặn nghiệp vụ: nơi gọi dùng giá mặc định.
 */
export function useResolvedPriceQuery(item: ResolvePriceItem | null, date: string) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'price-list', 'resolve', JSON.stringify(item), date),
    queryFn: async () => (await resolvePrices({ date, items: [item!] })).items[0] ?? null,
    enabled: item !== null && date !== '',
    retry: false,
  });
}

/** "Tra thử giá" — chỉ chạy khi người dùng bấm "Tra giá" (truyền `null` thì không gọi). */
export function useLookupPriceQuery(query: LookupPriceQuery | null) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'price-list', 'lookup', JSON.stringify(query)),
    queryFn: () => lookupPrice(query!),
    enabled: query !== null,
  });
}

function useInvalidate(domain: string) {
  const { tenantId } = useAppConfig();
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: queryKey(tenantId, domain) });
}

export function useCreateServicePackageMutation() {
  const invalidate = useInvalidate('service-package');
  return useMutation({ mutationFn: (body: CreateServicePackageRequest) => createServicePackage(body), onSuccess: invalidate });
}

export function useUpdateServicePackageMutation() {
  const invalidate = useInvalidate('service-package');
  // Giá gói đổi → dòng "Gói dịch vụ" trong bảng giá (giá mặc định/giá áp dụng) cũng phải mới.
  const invalidateLists = useInvalidate('price-list');
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdateServicePackageRequest }) => updateServicePackage(id, body),
    onSuccess: () => {
      invalidate();
      invalidateLists();
    },
  });
}

export function useCreatePriceListMutation() {
  const invalidate = useInvalidate('price-list');
  return useMutation({ mutationFn: (body: CreatePriceListRequest) => createPriceList(body), onSuccess: invalidate });
}

export function useUpdatePriceListMutation() {
  const invalidate = useInvalidate('price-list');
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: UpdatePriceListRequest }) => updatePriceList(id, body),
    onSuccess: invalidate,
  });
}
