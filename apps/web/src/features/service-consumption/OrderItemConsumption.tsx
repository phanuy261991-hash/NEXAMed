import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { NoticeRow } from '../../shared/ui/NoticeRow';
import { Skeleton } from '../../shared/ui/Skeleton';
import { useHasPermission } from '../auth/usePermission';
import { servicesMissingRecord } from './consumption-model';
import { ServiceConsumptionPanel } from './ServiceConsumptionPanel';
import { useEncounterConsumptionQuery } from './service-consumption.queries';

/**
 * Khối "Vật tư và thuốc đã dùng" ở màn nhập/duyệt kết quả cận lâm sàng (#297 GĐ4, màn 7A): một khối cho mỗi dòng chỉ định của phiếu (`itemIds`).
 * Có định mức mà chưa ghi thì nhắc ở ngay trên khối (không chặn duyệt kết quả). Không có quyền xem tiêu hao → ẩn hẳn, màn kết quả không đổi.
 */
export function OrderItemConsumption({ encounterId, itemIds }: { encounterId: string; itemIds: string[] }) {
  const canRead = useHasPermission('service_consumption', 'read');
  const query = useEncounterConsumptionQuery(encounterId, canRead);
  if (!canRead) return null;
  if (query.isLoading) return <Skeleton className="h-32 w-full" />;
  if (query.isError || !query.data) {
    return <ErrorBanner message="Không tải được vật tư và thuốc đã dùng." onRetry={() => void query.refetch()} />;
  }
  const services = query.data.services.filter((s) => s.target.kind === 'CLINICAL_ORDER_ITEM' && itemIds.includes(s.target.id));
  if (services.length === 0) return null;
  const missing = servicesMissingRecord(services);

  return (
    <section aria-label="Vật tư và thuốc đã dùng" className="space-y-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <h2 className="text-[15px] font-semibold text-slate-900">Vật tư và thuốc đã dùng</h2>
      {missing.length > 0 && (
        <NoticeRow title="Dịch vụ này có định mức vật tư nhưng chưa ghi vật tư đã dùng.">
          {missing.length > 1 ? `(${missing.map((m) => m.serviceName).join(', ')}) ` : ''}Bạn vẫn duyệt kết quả được; ghi bổ sung sau cũng được.
        </NoticeRow>
      )}
      {services.map((service) => (
        <div key={service.target.id} className="space-y-2">
          {services.length > 1 && <h3 className="text-sm font-semibold text-slate-800">{service.serviceName}</h3>}
          <ServiceConsumptionPanel encounterId={encounterId} service={service} canSeeCost={query.data.canSeeCost} warehouses={query.data.warehouses} idPrefix={`oc-${service.target.id}`} />
        </div>
      ))}
    </section>
  );
}
