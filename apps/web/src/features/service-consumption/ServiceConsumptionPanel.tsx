import { useState } from 'react';
import { ArrowCounterClockwise } from '@phosphor-icons/react';
import type { ConsumptionService, ConsumptionWarehouse } from '@nexamed/shared';
import { useSaveAttempt } from '../../shared/hooks/useSaveAttempt';
import { formatVnd } from '../../shared/format/currency';
import { Button } from '../../shared/ui/Button';
import { Combobox } from '../../shared/ui/Combobox';
import { ReasonConfirmDialog } from '../../shared/ui/ReasonConfirmDialog';
import { SaveErrorBanner } from '../../shared/ui/SaveErrorBanner';
import { useHasPermission } from '../auth/usePermission';
import { addDraftLine, draftFromNorm, toRequestLines, validateDraftLines, type ConsumptionDraftLine } from './consumption-model';
import { ConsumptionItemPicker } from './ConsumptionItemPicker';
import { ConsumptionDraftTable, ConsumptionRecordTable } from './ConsumptionTables';
import { useRecordConsumptionMutation, useReverseConsumptionMutation } from './service-consumption.queries';

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false }).format(d);
}

/**
 * Vật tư và thuốc đã dùng của MỘT lượt dịch vụ (#297 GĐ4, màn 7): chưa ghi → soạn (điền sẵn theo định mức, sửa theo số thực dùng) rồi lưu; đã ghi → chỉ đọc,
 * kèm người ghi và (nếu có quyền xem giá vốn) giá vốn từng dòng + tổng; sửa nhầm = "Đảo phiếu" có lý do rồi ghi lại. Không thu thêm tiền khách.
 * Lỗi lưu (thiếu tồn, trùng...) hiện tại chỗ và GIỮ NGUYÊN dữ liệu đang nhập.
 */
export function ServiceConsumptionPanel({
  encounterId,
  service,
  canSeeCost,
  warehouses,
  idPrefix,
}: {
  encounterId: string;
  service: ConsumptionService;
  canSeeCost: boolean;
  /** Kho chọn được làm kho trừ (kho chính đứng đầu). Chỉ một kho thì ẩn ô "Kho trừ", giao diện không đổi. */
  warehouses: ConsumptionWarehouse[];
  idPrefix: string;
}) {
  const record = service.record;
  if (record) return <RecordedView encounterId={encounterId} service={service} canSeeCost={canSeeCost} showWarehouse={warehouses.length > 1} />;
  return <DraftEditor key={service.target.id} encounterId={encounterId} service={service} warehouses={warehouses} idPrefix={idPrefix} />;
}

/** Nhãn một kho trong ô "Kho trừ": kho chính ghi rõ "(kho chính)", kho phụ kèm Khoa/Phòng quản lý nếu có. */
function warehouseLabel(w: ConsumptionWarehouse): string {
  if (w.isDefault) return `${w.name} (kho chính)`;
  return w.departmentName ? `${w.name} · ${w.departmentName}` : w.name;
}

function DraftEditor({ encounterId, service, warehouses, idPrefix }: { encounterId: string; service: ConsumptionService; warehouses: ConsumptionWarehouse[]; idPrefix: string }) {
  const canRecord = useHasPermission('service_consumption', 'record');
  const mutation = useRecordConsumptionMutation(encounterId);
  const { saveError, run, clear } = useSaveAttempt();
  const [validationError, setValidationError] = useState<string | null>(null);
  // `null` = chưa sửa: hiện sẵn định mức của dịch vụ (đổi định mức xong tải lại vẫn ra đúng, không phải chép vào state).
  const [edits, setEdits] = useState<ConsumptionDraftLine[] | null>(null);
  const lines = edits ?? draftFromNorm(service.norm);
  // Kho trừ: mặc định LUÔN là kho chính (chủ dự án chốt 12/11/2026), không nhớ lựa chọn lần trước. Chỉ một kho thì ẩn ô.
  const multiWarehouse = warehouses.length > 1;
  const [pickedWarehouseId, setPickedWarehouseId] = useState('');
  const warehouseId = warehouses.some((w) => w.id === pickedWarehouseId) ? pickedWarehouseId : (warehouses.find((w) => w.isDefault)?.id ?? warehouses[0]?.id ?? '');
  const warehouseOptions = warehouses.map((w) => ({ value: w.id, label: warehouseLabel(w) }));
  const chosenWarehouse = warehouses.find((w) => w.id === warehouseId);

  function change(next: ConsumptionDraftLine[]) {
    setEdits(next);
    setValidationError(null);
    clear();
  }

  async function save() {
    const invalid = validateDraftLines(lines, { allowEmpty: false });
    setValidationError(invalid);
    if (invalid) return;
    await run(() => mutation.mutateAsync({ encounterId, target: service.target, ...(multiWarehouse && warehouseId ? { warehouseId } : {}), lines: toRequestLines(lines) }));
  }

  if (!canRecord) {
    return <p className="text-sm text-slate-500">Chưa ghi vật tư và thuốc đã dùng cho dịch vụ này.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        {multiWarehouse && (
          <div className="flex w-[300px] max-w-full flex-col gap-1.5">
            <label htmlFor={`${idPrefix}-warehouse`} className="text-sm font-semibold text-slate-800">
              Kho trừ
            </label>
            <Combobox id={`${idPrefix}-warehouse`} value={warehouseId} options={warehouseOptions} onChange={setPickedWarehouseId} disabled={mutation.isPending} />
          </div>
        )}
        <div className="min-w-[260px] flex-1">
          <ConsumptionItemPicker
            id={`${idPrefix}-search`}
            label="Tìm vật tư hoặc thuốc để thêm"
            placeholder="Thêm vật tư / thuốc: gõ tên hoặc mã"
            excludeDrugIds={lines.map((l) => l.drugId)}
            onPick={(item) => change(addDraftLine(lines, item))}
          />
        </div>
        {service.norm.length > 0 && (
          <Button type="button" variant="secondary" onClick={() => change(draftFromNorm(service.norm))}>
            Điền theo định mức
          </Button>
        )}
      </div>
      <ConsumptionDraftTable idPrefix={idPrefix} lines={lines} onChange={change} showLot lotHint={multiWarehouse && chosenWarehouse ? `trong ${chosenWarehouse.name}` : undefined} emptyText="Chưa có vật tư hoặc thuốc nào" disabled={mutation.isPending} />
      {(validationError || saveError) && <SaveErrorBanner message={validationError ?? saveError?.message ?? ''} />}
      <div className="flex justify-end">
        <Button type="button" loading={mutation.isPending} disabled={lines.length === 0} onClick={() => void save()}>
          Lưu vật tư đã dùng
        </Button>
      </div>
    </div>
  );
}

function RecordedView({ encounterId, service, canSeeCost, showWarehouse }: { encounterId: string; service: ConsumptionService; canSeeCost: boolean; showWarehouse: boolean }) {
  const record = service.record!;
  const canReverse = useHasPermission('service_consumption', 'reverse');
  const reverse = useReverseConsumptionMutation(encounterId);
  const [reversing, setReversing] = useState(false);
  return (
    <div className="space-y-3">
      <ConsumptionRecordTable lines={record.lines} showCost={canSeeCost} />
      {canSeeCost && record.totalCost !== null && (
        <div className="flex items-center justify-between gap-2 border-t border-slate-200 px-1 pt-2.5 text-sm">
          <span className="text-slate-600">Tổng chi phí vốn của dịch vụ này</span>
          <b className="tabular-nums text-slate-900">{formatVnd(record.totalCost)}</b>
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-slate-600">
        <span>
          Ghi bởi {record.performedByName} · {formatDateTime(record.occurredAt)} · {record.issueNo}
          {showWarehouse && <> · <b className="font-semibold text-slate-800">{record.warehouseName}</b></>}
        </span>
        {canReverse && (
          <Button type="button" variant="dangerGhost" onClick={() => setReversing(true)}>
            <ArrowCounterClockwise size={16} weight="bold" aria-hidden="true" />
            Đảo phiếu
          </Button>
        )}
      </div>
      {reversing && (
        <ReasonConfirmDialog
          title="Đảo phiếu tiêu hao"
          rows={[{ label: 'Dịch vụ', value: service.serviceName, sub: record.issueNo }]}
          note="Vật tư và thuốc được hoàn về kho; phiếu cũ giữ lại và đánh dấu đã đảo."
          confirmLabel="Đảo phiếu"
          confirmVariant="danger"
          onConfirm={(reason) => reverse.mutateAsync({ issueId: record.id, body: { reason: reason.trim() } })}
          onDone={() => setReversing(false)}
          onClose={() => setReversing(false)}
        />
      )}
    </div>
  );
}
