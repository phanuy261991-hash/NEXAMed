import { useQuery } from '@tanstack/react-query';
import type { DashboardPeriodKind } from '@nexamed/shared';
import { useAppConfig } from '../../app/AppConfigProvider';
import { queryKey } from '../../shared/api/query-keys';
import { getOwnerDashboard } from './dashboard.api';

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
