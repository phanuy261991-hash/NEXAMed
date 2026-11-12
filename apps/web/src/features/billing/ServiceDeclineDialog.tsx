import { useMemo, useState } from 'react';
import { Clock, Info, MinusCircle, ProhibitInset, WarningCircle } from '@phosphor-icons/react';
import type { DeclineConsumptionAction, Invoice, ServiceDeclinePreviewItem } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { Combobox } from '../../shared/ui/Combobox';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { SelectionCheckbox } from '../../shared/ui/SelectionCheckbox';
import { Skeleton } from '../../shared/ui/Skeleton';
import { Textarea } from '../../shared/ui/Textarea';
import { formatVnd } from '../../shared/format/currency';
import { unitLabel, useUnitNameByCode } from '../drug/useUnitNameByCode';
import { useReferenceCatalogQuery } from '../reference-catalog/reference-catalog.queries';
import { useDeclineServicesMutation, useServiceDeclinePreviewQuery, useServiceDeclineQuoteQuery } from './invoice.queries';

/** Lý do hiện ở cột "Trạng thái" cho dòng CHƯA bị chặn (còn chờ làm). */
const WAITING_LABEL = 'Chờ làm';

function methodLabel(code: string, names: Map<string, string>): string {
  if (code === 'WALLET') return 'Về ví tạm ứng';
  return `Trả ${(names.get(code) ?? code).toLowerCase()}`;
}

/**
 * "Khách không làm dịch vụ" (docs/DECISIONS.md #280) — bác sĩ đã chỉ định dịch vụ kỹ thuật nhưng ra quầy khách không muốn làm. MỘT hộp thoại cho cả hai trạng thái phiếu:
 * phiếu chưa thu → gỡ dòng khỏi phiếu; phiếu đã thu → hoàn tiền theo đúng phương thức đã thu. Máy chủ tự chọn nhánh (`preview.action`), hộp thoại chỉ đọc để hiện câu hệ quả.
 *
 * MỌI số tiền do máy chủ tính (endpoint báo giá) — web không import `@nexamed/core` (#073) nên không tự cộng trừ, tránh lệch với bước xác nhận.
 * Bố cục BẢNG đúng khuôn `RefundDrugItemsDialog` (ui-guidelines mục 4.2/12: đầu bảng `border-blue-600`, kẻ giữa hàng, dải tổng cuối).
 */
export function ServiceDeclineDialog({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const previewQuery = useServiceDeclinePreviewQuery(invoice.encounterId, invoice.id);
  const preview = previewQuery.data;
  const reasonsQuery = useReferenceCatalogQuery('SERVICE_DECLINE_REASON');
  const methodsQuery = useReferenceCatalogQuery('PAYMENT_METHOD');

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [reasonCode, setReasonCode] = useState('');
  const [note, setNote] = useState('');
  // Vật tư tiêu hao đã ghi cho dịch vụ định bỏ (#297 GĐ4, màn 10): bắt buộc chọn giữ nguyên hay đảo phiếu + hoàn kho; chọn đảo thì phải có lý do.
  const [consumptionAction, setConsumptionAction] = useState<DeclineConsumptionAction | null>(null);
  const [consumptionReason, setConsumptionReason] = useState('');
  const unitNameByCode = useUnitNameByCode();
  const [error, setError] = useState<string | null>(null);
  const mutation = useDeclineServicesMutation(invoice.encounterId);

  const selectedIds = useMemo(() => [...selected], [selected]);
  const quoteQuery = useServiceDeclineQuoteQuery(invoice.encounterId, invoice.id, selectedIds);
  const quote = selectedIds.length > 0 ? quoteQuery.data : undefined;

  const reasonOptions = useMemo(() => (reasonsQuery.data?.items ?? []).map((r) => ({ value: r.code, label: r.name })), [reasonsQuery.data]);
  const methodNames = useMemo(() => new Map((methodsQuery.data?.items ?? []).map((m) => [m.code, m.name])), [methodsQuery.data]);

  const items = preview?.items ?? [];
  const declinableItems = items.filter((i) => i.declinable);
  const allSelected = declinableItems.length > 0 && declinableItems.every((i) => selected.has(i.orderItemId));
  const someSelected = declinableItems.some((i) => selected.has(i.orderItemId));

  function toggle(item: ServiceDeclinePreviewItem) {
    if (!item.declinable) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(item.orderItemId)) next.delete(item.orderItemId);
      else next.add(item.orderItemId);
      return next;
    });
  }
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(declinableItems.map((i) => i.orderItemId)));
  }

  const isRefund = preview?.action === 'REFUND';
  const selectedConsumptions = (preview?.consumptions ?? []).filter((c) => selected.has(c.orderItemId));
  const hasConsumption = selectedConsumptions.length > 0;
  const consumptionCost = selectedConsumptions.some((c) => c.totalCost !== null) ? selectedConsumptions.reduce((sum, c) => sum + (c.totalCost ?? 0), 0) : null;
  const consumptionOk = !hasConsumption || consumptionAction === 'KEEP' || (consumptionAction === 'REVERSE' && consumptionReason.trim().length >= 3);
  const canSubmit = !!preview && preview.action !== null && selected.size > 0 && reasonCode !== '' && !quoteQuery.isError && consumptionOk;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!preview || !canSubmit) return;
    setError(null);
    try {
      await mutation.mutateAsync({
        invoiceId: invoice.id,
        invoiceVersion: preview.invoiceVersion,
        orderItemIds: selectedIds,
        reasonCode,
        ...(note.trim() ? { reasonNote: note.trim() } : {}),
        ...(hasConsumption && consumptionAction ? { consumptionAction, ...(consumptionAction === 'REVERSE' ? { consumptionReason: consumptionReason.trim() } : {}) } : {}),
      });
      onClose();
    } catch (err) {
      // GIỮ NGUYÊN lựa chọn + lý do đang nhập (ui-guidelines 17b): chỉ hiện lỗi tại chỗ, không đóng hộp thoại.
      setError(err instanceof ApiError ? err.message : 'Có lỗi xảy ra, vui lòng thử lại.');
    }
  }

  const submitLabel =
    selected.size === 0 ? 'Xác nhận' : isRefund && quote && quote.amount > 0 ? `Xác nhận hoàn ${formatVnd(quote.amount)}` : `Xác nhận bỏ ${selected.size} dịch vụ`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-labelledby="service-decline-title">
      <div className="w-full max-w-3xl rounded-lg bg-white p-5 shadow-xl">
        <form onSubmit={(e) => void handleSubmit(e)}>
          <ModalHeader
            icon={MinusCircle}
            title="Khách không làm dịch vụ"
            subtitle={`Phiếu ${invoice.invoiceNo} · ${invoice.fullName} · ${invoice.patientCode} · ${invoice.status === 'PAID' ? 'phiếu đã thu' : 'phiếu chưa thu'}`}
            onClose={onClose}
          />

          {previewQuery.isPending && (
            <div className="space-y-2" aria-busy="true" aria-label="Đang tải danh sách dịch vụ">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          )}

          {previewQuery.isError && (
            <ErrorBanner message={previewQuery.error instanceof ApiError ? previewQuery.error.message : 'Không tải được danh sách dịch vụ của phiếu này.'} onRetry={() => void previewQuery.refetch()} />
          )}

          {preview && preview.action === null && <p className="text-sm text-slate-600">Phiếu này đã đóng sổ nên không còn dịch vụ nào để bỏ.</p>}

          {preview && preview.action !== null && items.length === 0 && <p className="text-sm text-slate-600">Phiếu này không có dịch vụ cận lâm sàng nào do bác sĩ chỉ định.</p>}

          {preview && preview.action !== null && items.length > 0 && (
            <>
              <p className="mb-2 text-sm font-semibold text-slate-800">Chọn dịch vụ khách không làm</p>
              <div className="overflow-hidden rounded-lg border border-slate-200">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b-2 border-blue-600 bg-slate-100 text-xs font-semibold uppercase tracking-wide text-slate-800">
                      <th className="w-10 py-2.5 pl-3 text-left">
                        <SelectionCheckbox checked={allSelected} indeterminate={!allSelected && someSelected} onChange={toggleAll} ariaLabel="Chọn tất cả dịch vụ bỏ được" />
                      </th>
                      <th className="px-2 py-2.5 text-left">Dịch vụ</th>
                      <th className="w-52 px-2 py-2.5 text-left">Trạng thái</th>
                      <th className="w-14 px-2 py-2.5 text-right">SL</th>
                      <th className="w-32 py-2.5 pl-2 pr-3 text-right">{isRefund ? 'Đã thu' : 'Thành tiền'}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => {
                      const isOn = selected.has(item.orderItemId);
                      return (
                        <tr key={item.orderItemId} className={`border-b border-slate-100 last:border-0 ${isOn ? 'bg-blue-50/50' : ''}`}>
                          <td className="py-3 pl-3">
                            {item.declinable ? (
                              <SelectionCheckbox checked={isOn} onChange={() => toggle(item)} ariaLabel={`Chọn bỏ ${item.name}`} />
                            ) : (
                              <input type="checkbox" disabled aria-label={`${item.name} không bỏ được`} className="h-4 w-4 cursor-not-allowed rounded border-slate-300" />
                            )}
                          </td>
                          <td className="px-2 py-3">
                            <div className={item.declinable ? 'font-semibold text-slate-900' : 'text-slate-400'}>{item.name}</div>
                            {item.packageName && <div className="text-xs text-slate-500">trong gói {item.packageName}</div>}
                          </td>
                          <td className="px-2 py-3">
                            {item.declinable ? (
                              <span className="text-[13px] text-slate-600">{WAITING_LABEL}</span>
                            ) : (
                              <span className="inline-flex items-center gap-1.5 text-[13px] text-amber-700">
                                {item.blockedReason === 'WORK_STARTED' ? <Clock size={14} weight="fill" aria-hidden="true" /> : <ProhibitInset size={14} weight="fill" aria-hidden="true" />}
                                {item.blockedLabel}
                              </span>
                            )}
                          </td>
                          <td className={`px-2 py-3 text-right tabular-nums ${item.declinable ? 'text-slate-700' : 'text-slate-400'}`}>{item.quantity}</td>
                          <td className={`py-3 pl-2 pr-3 text-right tabular-nums ${item.declinable ? 'font-semibold text-slate-900' : 'text-slate-400'}`}>
                            {item.amount === null ? <span className="text-slate-300">—</span> : formatVnd(item.amount)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>

                <div className="flex flex-wrap items-end justify-between gap-4 border-t border-slate-200 bg-slate-50 px-3 py-3">
                  <div className="text-sm leading-relaxed text-slate-600">
                    {selected.size === 0 && <div>Chọn dịch vụ khách không làm.</div>}
                    {selected.size > 0 && quoteQuery.isError && <div className="font-semibold text-rose-600">Không tính được số tiền — thử chọn lại.</div>}
                    {quote && isRefund && quote.refundBreakdown.length > 0 && (
                      <>
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tiền trả lại khách</div>
                        {quote.refundBreakdown.map((b) => (
                          <div key={b.method}>
                            {methodLabel(b.method, methodNames)}: <span className="font-semibold tabular-nums text-slate-900">{formatVnd(b.amount)}</span>
                          </div>
                        ))}
                      </>
                    )}
                    {quote && !isRefund && quote.surcharge > 0 && (
                      <div className="font-semibold text-amber-700">Khách phải trả thêm {formatVnd(quote.surcharge)} vì mất chiết khấu gói.</div>
                    )}
                    {quote && !isRefund && quote.newDueAmount !== null && (
                      <div>
                        Phải thu sau khi bỏ: <span className="font-semibold tabular-nums text-slate-900">{formatVnd(quote.newDueAmount)}</span>
                      </div>
                    )}
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">
                      {selected.size > 0 ? `Bỏ ${selected.size} dịch vụ` : 'Chưa chọn'}
                    </div>
                    <div className={`text-2xl font-semibold tabular-nums ${isRefund ? 'text-violet-700' : 'text-rose-700'}`} aria-live="polite">
                      {quote ? `− ${formatVnd(quote.amount)}` : selected.size > 0 ? <Skeleton className="ml-auto h-7 w-28" /> : '—'}
                    </div>
                  </div>
                </div>
              </div>
              <p className="mt-2 text-[13px] text-slate-500">Dịch vụ đã lấy mẫu hoặc đã thực hiện thì không bỏ được — việc đã làm vẫn phải trả tiền.</p>

              <div className="mt-3.5 grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="service-decline-reason" className="mb-1 block text-sm font-semibold text-slate-800">
                    Lý do<span className="text-rose-500"> *</span>
                  </label>
                  <Combobox id="service-decline-reason" value={reasonCode} options={reasonOptions} onChange={setReasonCode} placeholder="Chọn lý do..." required />
                  {reasonsQuery.isError && <p className="mt-1 text-xs font-semibold text-rose-600">Không tải được danh sách lý do — đóng hộp thoại rồi mở lại.</p>}
                </div>
                <Textarea id="service-decline-note" label="Ghi thêm" rows={1} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Không bắt buộc" maxLength={500} />
              </div>

              {hasConsumption && (
                <div className="mt-3.5 space-y-3 border-t border-slate-100 pt-3.5">
                  <div role="region" aria-label="Vật tư đã ghi tiêu hao" className="flex items-start gap-2.5">
                    <WarningCircle size={18} weight="fill" className="mt-0.5 flex-shrink-0 text-amber-600" aria-hidden="true" />
                    <div className="min-w-0 text-sm">
                      <div className="font-semibold text-amber-800">{selectedConsumptions.length > 1 ? 'Các dịch vụ này đã ghi tiêu hao vật tư.' : 'Dịch vụ này đã ghi tiêu hao vật tư.'}</div>
                      {selectedConsumptions.map((c) => (
                        <div key={c.orderItemId} className="mt-1 text-slate-700">
                          {c.lines.map((l) => `${l.drugName} ×${l.quantity}${l.baseUnitCode ? ` ${unitLabel(unitNameByCode, l.baseUnitCode).toLowerCase()}` : ''}`).join(' · ')}
                        </div>
                      ))}
                      {consumptionCost !== null && <div className="mt-1 text-slate-500">Chi phí vốn {formatVnd(consumptionCost)}</div>}
                    </div>
                  </div>

                  <div>
                    <span id="service-decline-consumption-label" className="mb-1.5 block text-sm font-semibold text-slate-800">
                      Vật tư đã ghi xử lý thế nào?<span className="text-rose-500"> *</span>
                    </span>
                    <div role="radiogroup" aria-labelledby="service-decline-consumption-label" className="grid gap-2 sm:grid-cols-2">
                      {(
                        [
                          { value: 'KEEP', label: 'Giữ nguyên, vật tư đã dùng, không hoàn kho', hint: 'Chi phí vẫn tính vào dịch vụ đã huỷ.', disabled: false },
                          {
                            value: 'REVERSE',
                            label: 'Đảo phiếu tiêu hao và hoàn kho',
                            hint: preview.canReverseConsumption ? 'Phiếu cũ được giữ lại và đánh dấu đã đảo.' : 'Cần quyền đảo phiếu tiêu hao; nhờ quản lý.',
                            disabled: !preview.canReverseConsumption,
                          },
                        ] as const
                      ).map((opt) => {
                        const on = consumptionAction === opt.value;
                        return (
                          <label
                            key={opt.value}
                            className={`block rounded-lg border px-3.5 py-2.5 ${opt.disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer'} ${
                              on ? 'border-brand-teal bg-brand-teal text-white' : `border-slate-300 ${opt.disabled ? '' : 'hover:border-blue-400 hover:bg-brand-teal-tint'}`
                            }`}
                          >
                            <input type="radio" name="service-decline-consumption" className="sr-only" checked={on} disabled={opt.disabled} onChange={() => setConsumptionAction(opt.value)} />
                            <span className={`block text-[13.5px] font-semibold ${on ? '' : 'text-slate-900'}`}>{opt.label}</span>
                            <span className={`mt-0.5 block text-[11.5px] ${on ? 'opacity-90' : 'text-slate-500'}`}>{opt.hint}</span>
                          </label>
                        );
                      })}
                    </div>
                    <div className="mt-2.5">
                      <Textarea
                        id="service-decline-consumption-reason"
                        label="Lý do đảo phiếu"
                        rows={2}
                        value={consumptionReason}
                        onChange={(e) => setConsumptionReason(e.target.value)}
                        disabled={consumptionAction !== 'REVERSE'}
                        placeholder={consumptionAction === 'REVERSE' ? 'Nhập lý do đảo phiếu' : 'Chỉ nhập khi chọn "Đảo phiếu tiêu hao và hoàn kho"'}
                        maxLength={500}
                      />
                    </div>
                  </div>
                </div>
              )}

              <div className="mt-3.5 flex items-start gap-2.5 border-t border-slate-100 pt-3">
                <Info size={18} weight="fill" className="mt-0.5 flex-shrink-0 text-blue-600" aria-hidden="true" />
                <p className="text-[13px] leading-relaxed text-slate-600">
                  {preview.action === 'REFUND' ? (
                    <>
                      Phiếu đã thu nên hệ thống <strong className="font-semibold text-slate-800">sinh phiếu hoàn</strong> cho phần tiền của dịch vụ đã bỏ.
                    </>
                  ) : quote?.action === 'NO_MONEY_CHANGE' ? (
                    <>Giữ nguyên giá gói nên <strong className="font-semibold text-slate-800">tiền không đổi</strong>.</>
                  ) : (
                    <>
                      Phiếu chưa thu nên dịch vụ được <strong className="font-semibold text-slate-800">gỡ khỏi phiếu</strong>
                      {quote?.newDueAmount != null && <>, tổng phải thu còn <strong className="font-semibold tabular-nums text-blue-600">{formatVnd(quote.newDueAmount)}</strong></>}.
                    </>
                  )}{' '}
                  Dòng chỉ định chuyển sang <strong className="font-semibold text-slate-800">Đã huỷ</strong> kèm lý do, bác sĩ vẫn xem được.
                </p>
              </div>
            </>
          )}

          {error && (
            <p role="alert" className="mt-3 text-sm font-semibold text-rose-600">
              {error}
            </p>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Huỷ
            </Button>
            <Button type="submit" variant="danger" disabled={!canSubmit} loading={mutation.isPending}>
              {submitLabel}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
