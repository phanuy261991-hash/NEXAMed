import { useQuery } from '@tanstack/react-query';
import type { DashboardPeriodKind } from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import { getCashierShiftSummary } from '../cashier-shift/cashier-shift.api';
import { getCashierDashboard, getOwnerDashboard, getReceptionDashboard } from './dashboard.api';

/**
 * Trang Tổng quan chủ phòng khám. CHỈ tải khi vào trang, khi đổi kỳ và khi bấm "Làm mới" (docs/DECISIONS.md #279, điểm chốt 7): không tự làm mới theo chu kỳ, không làm mới khi quay lại cửa sổ,
 * để máy chủ phòng khám nhẹ và người xem biết rõ số được chụp lúc nào ("Số lúc HH:MM").
 */
export function useOwnerDashboardQuery(period: DashboardPeriodKind) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'report', 'dashboard', 'owner', period),
    queryFn: () => getOwnerDashboard(period),
    // Vào lại trang là chụp số mới (không hiện số cũ lưu trong bộ nhớ đệm); ngoài ra chỉ khi bấm "Làm mới".
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  });
}

/** Trang Tổng quan lễ tân (#284) — cùng nguyên tắc "chỉ tải khi vào trang / bấm Làm mới". */
export function useReceptionDashboardQuery() {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'report', 'dashboard', 'reception'),
    queryFn: getReceptionDashboard,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  });
}

/** Trang Tổng quan thu ngân (#283) — cùng nguyên tắc "chỉ tải khi vào trang / bấm Làm mới" như bản chủ phòng khám. */
export function useCashierDashboardQuery() {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'report', 'dashboard', 'cashier'),
    queryFn: getCashierDashboard,
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  });
}

/**
 * Tổng kết SỐNG của ca đang mở cho khối "Tiền mặt dự kiến trong két". Khác `useCashierShiftSummaryQuery` (làm mới 15 giây một lần cho bước 1 hộp Chốt ca): ở Tổng quan số chỉ đổi khi bấm
 * "Làm mới" để cả trang cùng một thời điểm. Khoá nằm dưới `cashier-shift` nên mở ca/chốt ca tự làm mới.
 */
export function useDashboardShiftSummaryQuery(shiftId: string, enabled: boolean) {
  const { tenantId } = useAppConfig();
  return useQuery({
    queryKey: queryKey(tenantId, 'cashier-shift', 'dashboard-summary', shiftId),
    queryFn: () => getCashierShiftSummary(shiftId),
    enabled: enabled && shiftId !== '',
    staleTime: 0,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 1,
  });
}
