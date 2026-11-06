import { useQuery } from '@tanstack/react-query';
import { useAppConfig } from '../../../app/AppConfigProvider';
import { queryKey } from '../../../shared/api/query-keys';
import { getQualityIncomplete, getQualityInterop, type QualityPeriodParams } from './quality.api';

/** Số chỉ tải khi vào trang, đổi bộ lọc/kỳ/phạm vi hoặc bấm "Làm mới" (docs/DECISIONS.md #279): không tự làm mới nền. `enabled=false` khi kỳ tuỳ chọn đang nhập sai. */
function reportOptions(enabled: boolean) {
  return { enabled, staleTime: Infinity, refetchOnWindowFocus: false } as const;
}

export function useQualityIncompleteQuery(p: QualityPeriodParams, enabled: boolean) {
  const { tenantId } = useAppConfig();
  // Ảnh chụp đến hôm nay: khoá chỉ theo phạm vi chi nhánh, đổi kỳ ở trang không làm tải lại.
  return useQuery({ queryKey: queryKey(tenantId, 'report', 'quality', 'incomplete', JSON.stringify([p.scope, p.branchIds])), queryFn: () => getQualityIncomplete(p), ...reportOptions(enabled) });
}

export function useQualityInteropQuery(p: QualityPeriodParams, enabled: boolean) {
  const { tenantId } = useAppConfig();
  return useQuery({ queryKey: queryKey(tenantId, 'report', 'quality', 'interop', JSON.stringify([p.from, p.to, p.scope, p.branchIds])), queryFn: () => getQualityInterop(p), ...reportOptions(enabled) });
}
