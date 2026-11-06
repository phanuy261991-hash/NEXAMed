import { useQuery } from '@tanstack/react-query';
import { useAppConfig } from '../../../app/AppConfigProvider';
import { queryKey } from '../../../shared/api/query-keys';
import { getPatientDemographics, getPatientNewReturning, getPatientNotReturning, type PatientPeriodParams } from './patients.api';

function periodKey(p: PatientPeriodParams): string {
  return JSON.stringify([p.from, p.to, p.scope, p.branchIds]);
}

/** Số chỉ tải khi vào trang, đổi bộ lọc/kỳ/phạm vi hoặc bấm "Làm mới" (docs/DECISIONS.md #279): không tự làm mới nền. `enabled=false` khi kỳ tuỳ chọn đang nhập sai. */
function reportOptions(enabled: boolean) {
  return { enabled, staleTime: Infinity, refetchOnWindowFocus: false } as const;
}

export function usePatientNewReturningQuery(p: PatientPeriodParams, enabled: boolean) {
  const { tenantId } = useAppConfig();
  return useQuery({ queryKey: queryKey(tenantId, 'report', 'patients', 'new-returning', periodKey(p)), queryFn: () => getPatientNewReturning(p), ...reportOptions(enabled) });
}

export function usePatientDemographicsQuery(p: PatientPeriodParams, enabled: boolean) {
  const { tenantId } = useAppConfig();
  return useQuery({ queryKey: queryKey(tenantId, 'report', 'patients', 'demographics', periodKey(p)), queryFn: () => getPatientDemographics(p), ...reportOptions(enabled) });
}

export function usePatientNotReturningQuery(p: PatientPeriodParams, enabled: boolean) {
  const { tenantId } = useAppConfig();
  return useQuery({ queryKey: queryKey(tenantId, 'report', 'patients', 'not-returning', periodKey(p)), queryFn: () => getPatientNotReturning(p), ...reportOptions(enabled) });
}
