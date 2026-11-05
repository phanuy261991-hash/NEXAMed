import { useQuery } from '@tanstack/react-query';
import { useAppConfig } from '../../../app/AppConfigProvider';
import { queryKey } from '../../../shared/api/query-keys';
import { getDoctorHours, getDoctorOrderMix, getDoctorPerformance, type DoctorPeriodParams } from './doctors.api';

function periodKey(p: DoctorPeriodParams): string {
  return JSON.stringify([p.from, p.to, p.scope, p.branchIds, p.departmentId ?? '']);
}

/** Số chỉ tải khi vào trang, đổi bộ lọc/kỳ/phạm vi/Khoa hoặc bấm "Làm mới" (docs/DECISIONS.md #279): không tự làm mới nền. `enabled=false` khi kỳ tuỳ chọn đang nhập sai. */
function reportOptions(enabled: boolean) {
  return { enabled, staleTime: Infinity, refetchOnWindowFocus: false } as const;
}

export function useDoctorPerformanceQuery(p: DoctorPeriodParams, enabled: boolean) {
  const { tenantId } = useAppConfig();
  return useQuery({ queryKey: queryKey(tenantId, 'report', 'doctors', 'performance', periodKey(p)), queryFn: () => getDoctorPerformance(p), ...reportOptions(enabled) });
}

export function useDoctorOrderMixQuery(p: DoctorPeriodParams, enabled: boolean) {
  const { tenantId } = useAppConfig();
  return useQuery({ queryKey: queryKey(tenantId, 'report', 'doctors', 'order-mix', periodKey(p)), queryFn: () => getDoctorOrderMix(p), ...reportOptions(enabled) });
}

export function useDoctorHoursQuery(p: DoctorPeriodParams, enabled: boolean) {
  const { tenantId } = useAppConfig();
  return useQuery({ queryKey: queryKey(tenantId, 'report', 'doctors', 'hours', periodKey(p)), queryFn: () => getDoctorHours(p), ...reportOptions(enabled) });
}
