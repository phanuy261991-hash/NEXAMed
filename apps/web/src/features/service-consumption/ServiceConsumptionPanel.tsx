import { useState } from 'react';
import { ArrowCounterClockwise } from '@phosphor-icons/react';
import type { ConsumptionService } from '@nexamed/shared';
import { useSaveAttempt } from '../../shared/hooks/useSaveAttempt';
import { formatVnd } from '../../shared/format/currency';
import { Button } from '../../shared/ui/Button';
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
export function ServiceConsumptionPanel({ encounterId, service, canSeeCost, idPrefix }: { encounterId: string; service: ConsumptionService; canSeeCost: boolean; idPrefix: string }) {
  const record = service.record;
  if (record) return <RecordedView encounterId={encounterId} service={service} canSeeCost={canSeeCost} />;
  return <DraftEditor key={service.target.id} encounterId={encounterId} service={service} idPrefix={idPrefix} />;
}

function DraftEditor({ encounterId, service, idPrefix }: { encounterId: string; service: ConsumptionService; idPrefix: string }) {
  const canRecord = useHasPermission('service_consumption', 'record');
  const mutation = useRecordConsumptionMutation(encounterId);
  const { saveError, run, clear } = useSaveAttempt();
  const [validationError, setValidationError] = useState<string | null>(null);
  // `null` = chưa sửa: hiện sẵn định mức của dịch vụ (đổi định mức xong tải lại vẫn ra đúng, không phải chép vào state).
  const [edits, setEdits] = useState<ConsumptionDraftLine[] | null>(null);
  const lines = edits ?? draftFromNorm(service.norm);

  function change(next: ConsumptionDraftLine[]) {
    setEdits(next);
    setValidationError(null);
    clear();
  }

  async function save() {
    const invalid = validateDraftLines(lines, { allowEmpty: false });
    setValidationError(invalid);
    if (invalid) return;
    await run(() => mutation.mutateAsync({ encounterId, target: service.target, lines: toRequestLines(lines) }));
  }

  if (!canRecord) {
    return <p className="text-sm text-slate-500">Chưa ghi vật tư và thuốc đã dùng cho dịch vụ này.</p>;
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
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
      <ConsumptionDraftTable idPrefix={idPrefix} lines={lines} onChange={change} showLot emptyText="Chưa có vật tư hoặc thuốc nào" disabled={mutation.isPending} />
      {(validationError || saveError) && <SaveErrorBanner message={validationError ?? saveError?.message ?? ''} />}
      <div className="flex justify-end">
        <Button type="button" loading={mutation.isPending} disabled={lines.length === 0} onClick={() => void save()}>
          Lưu vật tư đã dùng
        </Button>
      </div>
    </div>
  );
}

function RecordedView({ encounterId, service, canSeeCost }: { encounterId: string; service: ConsumptionService; canSeeCost: boolean }) {
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
