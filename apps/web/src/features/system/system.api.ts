import type { SystemVersion } from '@nexamed/shared';
import { getApiClient, unwrap } from '../../shared/api/client';

/** Phiên bản phần mềm đang chạy ở máy chủ (docs/DECISIONS.md #236) — endpoint công khai, gọi được cả khi chưa đăng nhập. */
export async function getSystemVersion(): Promise<SystemVersion> {
  return unwrap(await getApiClient().GET('/api/v1/system/version')) as SystemVersion;
}
