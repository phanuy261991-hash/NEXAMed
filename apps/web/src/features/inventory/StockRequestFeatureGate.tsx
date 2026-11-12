import type { ReactNode } from 'react';
import { ClipboardText } from '@phosphor-icons/react';
import { Link } from 'react-router-dom';
import { Skeleton } from '../../shared/ui/Skeleton';
import { EmptyState } from '../../shared/ui/EmptyState';
import { useHasPermission } from '../auth/usePermission';
import { useStockRequestEnabledQuery } from '../clinic/clinic.queries';

/**
 * Cổng của mọi trang "Yêu cầu cấp hàng" (docs/DECISIONS.md #298): công tắc "Dùng yêu cầu cấp hàng" đang TẮT thì báo rõ bằng lời tiếng Việt kèm lối đi tiếp thay vì để người dùng
 * gặp lỗi 409 thô. Máy chủ vẫn là nơi chặn thật; đây chỉ là trang báo thân thiện (ví dụ khi mở dấu trang cũ).
 */
export function StockRequestFeatureGate({ children }: { children: ReactNode }) {
  const enabledQuery = useStockRequestEnabledQuery();
  const canConfigure = useHasPermission('clinic_config', 'update');
  if (enabledQuery.isPending) {
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    );
  }
  // Không đọc được công tắc (lỗi mạng) thì vẫn cho vào — trang tự báo lỗi tải dữ liệu của nó; chỉ chặn khi công tắc chắc chắn TẮT.
  if (enabledQuery.data?.enabled === false) {
    return (
      <div className="p-3">
        <EmptyState
          icon={ClipboardText}
          title="Phòng khám đang tắt Yêu cầu cấp hàng"
          description={canConfigure ? 'Bật lại ở Cấu hình hệ thống, Cấu hình chung, mục Kho.' : 'Hãy liên hệ quản lý phòng khám nếu cần dùng chức năng này.'}
          action={
            <Link to={canConfigure ? '/admin/system-config' : '/inventory/transfers'} className="text-sm font-semibold text-blue-600 hover:underline">
              {canConfigure ? 'Mở Cấu hình hệ thống' : 'Về Điều chuyển kho'}
            </Link>
          }
        />
      </div>
    );
  }
  return <>{children}</>;
}
