import type { DashboardPeriodKind, OwnerDashboard } from '@nexamed/shared';
import { getApiClient, unwrap } from '../../shared/api/client';

export async function getOwnerDashboard(period: DashboardPeriodKind): Promise<OwnerDashboard> {
  return unwrap(await getApiClient().GET('/api/v1/reports/dashboard/owner', { params: { query: { period } } })) as OwnerDashboard;
}
