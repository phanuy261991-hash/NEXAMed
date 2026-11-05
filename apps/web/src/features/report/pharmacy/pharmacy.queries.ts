import { useQuery } from '@tanstack/react-query';
import { useAppConfig } from '../../../app/AppConfigProvider';
import { queryKey } from '../../../shared/api/query-keys';
import { getPharmacyControlled, getPharmacyDispensed, getPharmacyMargin, type ControlledPeriodParams, type PharmacyPeriodParams } from './pharmacy.api';

function periodKey(p: PharmacyPeriodParams): string {
  return JSON.stringify([p.from, p.to, p.scope, p.branchIds, p.itemType ?? 'ALL']);
}

function controlledKey(p: ControlledPeriodParams): string {
  return JSON.stringify([p.from, p.to, p.scope, p.branchIds, p.controlType ?? 'ALL']);
}

/** Số chỉ tải khi vào trang, đổi bộ lọc/kỳ/phạm vi/Loại hoặc bấm "Làm mới" (docs/DECISIONS.md #279): không tự làm mới nền. `enabled=false` khi kỳ tuỳ chọn đang nhập sai. */
function reportOptions(enabled: boolean) {
  return { enabled, staleTime: Infinity, refetchOnWindowFocus: false } as const;
}

export function usePharmacyDispensedQuery(p: PharmacyPeriodParams, enabled: boolean) {
  const { tenantId } = useAppConfig();
  return useQuery({ queryKey: queryKey(tenantId, 'report', 'pharmacy', 'dispensed', periodKey(p)), queryFn: () => getPharmacyDispensed(p), ...reportOptions(enabled) });
}

export function usePharmacyMarginQuery(p: PharmacyPeriodParams, enabled: boolean) {
  const { tenantId } = useAppConfig();
  return useQuery({ queryKey: queryKey(tenantId, 'report', 'pharmacy', 'margin', periodKey(p)), queryFn: () => getPharmacyMargin(p), ...reportOptions(enabled) });
}

export function usePharmacyControlledQuery(p: ControlledPeriodParams, enabled: boolean) {
  const { tenantId } = useAppConfig();
  return useQuery({ queryKey: queryKey(tenantId, 'report', 'pharmacy', 'controlled', controlledKey(p)), queryFn: () => getPharmacyControlled(p), ...reportOptions(enabled) });
}
