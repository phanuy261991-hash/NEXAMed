import { useState } from 'react';
import { Package } from '@phosphor-icons/react';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { SegmentedToggle } from '../../shared/ui/SegmentedToggle';
import { Skeleton } from '../../shared/ui/Skeleton';
import { consumptionTargetKey, servicesMissingRecord } from './consumption-model';
import { ServiceConsumptionPanel } from './ServiceConsumptionPanel';
import { useEncounterConsumptionQuery } from './service-consumption.queries';

/**
 * Tab "Vật tư đã dùng" ở màn khám (#297 GĐ4, màn 7B): các dịch vụ khám đã chọn lúc Tiếp nhận (Tiêm bắp, Khám nội tổng quát...), chọn một dịch vụ rồi ghi/xem
 * vật tư và thuốc đã dùng. Dịch vụ cận lâm sàng ghi ở màn nhập kết quả của chúng, không ở đây. Không thu thêm tiền khách.
 */
export function EncounterConsumptionTab({ encounterId }: { encounterId: string }) {
  const query = useEncounterConsumptionQuery(encounterId);
  const [selected, setSelected] = useState<string | null>(null);

  if (query.isLoading) return <Skeleton className="h-48 w-full" />;
  if (query.isError || !query.data) return <ErrorBanner message="Không tải được vật tư đã dùng của lượt khám này." onRetry={() => void query.refetch()} />;

  const services = query.data.services.filter((s) => s.target.kind === 'ENCOUNTER_SERVICE_ITEM');
  if (services.length === 0) {
    return <EmptyState icon={Package} title="Lượt khám chưa có dịch vụ khám" description="Dịch vụ khám chọn ở bước Tiếp nhận sẽ hiện ở đây để ghi vật tư đã dùng." />;
  }
  const missingKeys = new Set(servicesMissingRecord(services).map((s) => consumptionTargetKey(s.target)));
  const current = services.find((s) => consumptionTargetKey(s.target) === selected) ?? services[0]!;
  const items = services.map((s) => ({ id: consumptionTargetKey(s.target), label: missingKeys.has(consumptionTargetKey(s.target)) ? `${s.serviceName} •` : s.serviceName }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-slate-600">Dịch vụ:</span>
        <SegmentedToggle ariaLabel="Chọn dịch vụ" items={items} value={consumptionTargetKey(current.target)} onChange={setSelected} />
      </div>
      {missingKeys.size > 0 && <p className="text-sm text-slate-500">Dấu • là dịch vụ có định mức mà chưa ghi vật tư đã dùng.</p>}
      <ServiceConsumptionPanel key={current.target.id} encounterId={encounterId} service={current} canSeeCost={query.data.canSeeCost} warehouses={query.data.warehouses} idPrefix={`ec-${current.target.id}`} />
    </div>
  );
}
