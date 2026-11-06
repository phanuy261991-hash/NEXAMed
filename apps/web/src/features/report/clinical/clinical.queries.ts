import { useQuery } from '@tanstack/react-query';
import { useAppConfig } from '../../../app/AppConfigProvider';
import { queryKey } from '../../../shared/api/query-keys';
import { getClinicalDiagnoses, getClinicalParaclinical, type ClinicalPeriodParams } from './clinical.api';

function periodKey(p: ClinicalPeriodParams): string {
  return JSON.stringify([p.from, p.to, p.scope, p.branchIds]);
}

/** Số chỉ tải khi vào trang, đổi bộ lọc/kỳ/phạm vi hoặc bấm "Làm mới" (docs/DECISIONS.md #279): không tự làm mới nền. `enabled=false` khi kỳ tuỳ chọn đang nhập sai. */
function reportOptions(enabled: boolean) {
  return { enabled, staleTime: Infinity, refetchOnWindowFocus: false } as const;
}

export function useClinicalDiagnosesQuery(p: ClinicalPeriodParams, enabled: boolean) {
  const { tenantId } = useAppConfig();
  return useQuery({ queryKey: queryKey(tenantId, 'report', 'clinical', 'diagnoses', periodKey(p)), queryFn: () => getClinicalDiagnoses(p), ...reportOptions(enabled) });
}

export function useClinicalParaclinicalQuery(p: ClinicalPeriodParams, enabled: boolean) {
  const { tenantId } = useAppConfig();
  return useQuery({ queryKey: queryKey(tenantId, 'report', 'clinical', 'paraclinical', periodKey(p)), queryFn: () => getClinicalParaclinical(p), ...reportOptions(enabled) });
}
