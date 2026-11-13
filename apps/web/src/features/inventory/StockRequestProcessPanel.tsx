import { useMemo, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { ArrowsLeftRight, CalendarCheck, Prohibit, ShoppingCart } from '@phosphor-icons/react';
import type { AllocateStockRequestLine, StockRequestDetail, StockRequestLine, StockRequestRemainder } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog';
import { DateInput } from '../../shared/ui/DateInput';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { useHasPermission } from '../auth/usePermission';
import { usePurchaseOrderOptionsQuery, usePurchaseOrdersQuery } from './purchase-order.queries';
import { ORDER_STATUS_META } from './purchase-order-meta';
import { useAllocateStockRequestMutation } from './stock-request.queries';
import { formatDayVn, REQUEST_LINE_STATUS_META } from './stock-request-meta';

const GRID = 'minmax(150px,1.2fr) 56px 84px 76px 84px 84px minmax(170px,1.1fr)';

interface LineState {
  qty: string;
  remainder: StockRequestRemainder | null;
}

function openLines(request: StockRequestDetail): StockRequestLine[] {
  return request.lines.filter((l) => l.fulfilStatus === 'PENDING' || l.fulfilStatus === 'WAITING_STOCK');
}

/** Số cấp mặc định: cấp được tối đa theo tồn kho cấp, không vượt phần còn thiếu. */
function defaultQty(line: StockRequestLine): number {
  return Math.max(Math.min(line.remainingQty, line.supplierStock ?? 0), 0);
}

/**
 * Khối xử lý của KHO CẤP trên phiếu đã tiếp nhận (docs/DECISIONS.md #298, mockup màn 5 và 5b). Mỗi dòng còn mở có ô "Số cấp"; phần chưa cấp chọn "Chờ hàng về" hoặc "Từ chối", cả hai
 * bắt buộc ghi lý do. Bấm "Chuyển thành phiếu điều chuyển" tạo MỘT phiếu điều chuyển nháp mang sẵn mặt hàng, số cấp và gợi ý lô theo hạn dùng; dòng chờ hàng về giữ mở để "Cấp tiếp".
 * Dùng `key={request.version}` ở nơi gọi để đặt lại trạng thái nhập sau mỗi lần cấp.
 */
export function StockRequestProcessPanel({ request, footSlot }: { request: StockRequestDetail; footSlot: HTMLElement | null }) {
  const navigate = useNavigate();
  const mutation = useAllocateStockRequestMutation();
  const open = useMemo(() => openLines(request), [request]);
  const [state, setState] = useState<Record<string, LineState>>(() => Object.fromEntries(open.map((l) => [l.id, { qty: String(defaultQty(l)), remainder: null }])));
  const [remainderFor, setRemainderFor] = useState<{ line: StockRequestLine; action: 'WAIT' | 'REJECT' } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // "Đặt NCC cho phần thiếu" (#298 giai đoạn 2): chỉ hiện khi có dòng đang chờ hàng về, người dùng được lập đơn và chi nhánh này được đặt hàng riêng.
  const canCreateOrder = useHasPermission('purchase_order', 'create');
  const orderOptions = usePurchaseOrderOptionsQuery(canCreateOrder);
  const hasWaitingLine = request.lines.some((l) => l.fulfilStatus === 'WAITING_STOCK' && l.remainingQty > 0);
  const showOrderButton = canCreateOrder && orderOptions.data?.canOrderHere === true && hasWaitingLine;

  function missingOf(line: StockRequestLine): number {
    const qty = Number(state[line.id]?.qty || 0);
    return Math.max(line.remainingQty - (Number.isFinite(qty) ? qty : 0), 0);
  }

  /** Dựng nội dung gửi lên; trả lỗi tiếng Việt nếu còn dòng chưa hợp lệ. */
  function buildPayload(): { lines: AllocateStockRequestLine[]; error: string | null; transferLineCount: number; totalQty: number } {
    const lines: AllocateStockRequestLine[] = [];
    let transferLineCount = 0;
    let totalQty = 0;
    for (const line of open) {
      const s = state[line.id];
      const qty = Number(s?.qty || 0);
      if (!Number.isInteger(qty) || qty < 0) return { lines, error: `Số cấp của "${line.drugName}" không hợp lệ.`, transferLineCount, totalQty };
      if (qty > line.remainingQty) return { lines, error: `Số cấp của "${line.drugName}" vượt số còn thiếu (${line.remainingQty}).`, transferLineCount, totalQty };
      if (line.supplierStock !== null && qty > line.supplierStock) return { lines, error: `Kho không đủ tồn để cấp "${line.drugName}" (tồn ${line.supplierStock}).`, transferLineCount, totalQty };
      const stillMissing = line.remainingQty - qty;
      if (stillMissing > 0 && !s?.remainder) {
        return { lines, error: `"${line.drugName}" còn thiếu ${stillMissing}: chọn "Chờ hàng về" hoặc "Từ chối" và ghi lý do.`, transferLineCount, totalQty };
      }
      if (qty === 0 && stillMissing === 0) continue;
      lines.push({ lineId: line.id, allocateQty: qty, ...(stillMissing > 0 && s?.remainder ? { remainder: s.remainder } : {}) });
      if (qty > 0) {
        transferLineCount += 1;
        totalQty += qty;
      }
    }
    if (lines.length === 0) return { lines, error: 'Chưa có dòng nào để cấp hoặc quyết định.', transferLineCount, totalQty };
    return { lines, error: null, transferLineCount, totalQty };
  }

  const preview = confirming ? buildPayload() : null;

  const reasonRows = request.lines.flatMap((line) => {
    const draft = state[line.id]?.remainder;
    const reason = draft?.reason ?? line.decisionReason ?? line.withdrawReason;
    const shown = draft || line.fulfilStatus === 'REJECTED' || line.fulfilStatus === 'WAITING_STOCK' || line.fulfilStatus === 'WITHDRAWN';
    const expected = draft ? draft.expectedDate : line.waitExpectedDate;
    return shown && reason ? [{ key: line.id, name: line.drugName, reason: reason + (expected ? ` (dự kiến ${formatDayVn(expected)})` : '') }] : [];
  });

  function startConfirm() {
    const built = buildPayload();
    if (built.error) {
      setError(built.error);
      return;
    }
    setError(null);
    setConfirming(true);
  }

  async function submit() {
    const built = buildPayload();
    if (built.error) {
      setError(built.error);
      setConfirming(false);
      return;
    }
    try {
      const result = await mutation.mutateAsync({ id: request.id, body: { version: request.version, lines: built.lines } });
      setConfirming(false);
      setError(null);
      const created = result.transfers.find((t) => !request.transfers.some((x) => x.id === t.id));
      if (created && created.canOpen) navigate(`/inventory/transfers/${created.id}`);
    } catch (err) {
      setConfirming(false);
      setError(err instanceof ApiError ? err.message : 'Cấp hàng thất bại, vui lòng thử lại.');
    }
  }

  return (
    <div className="flex flex-col gap-2.5 lg:min-h-0 lg:flex-1">
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm lg:min-h-0 lg:flex-1">
        <div role="table" aria-label="Xử lý các dòng yêu cầu" className="scroll-hover overflow-x-auto lg:h-full">
          <div className="flex flex-col lg:h-full" style={{ minWidth: 800 }}>
            <div role="row" style={{ gridTemplateColumns: GRID }} className="grid flex-shrink-0 gap-x-3 border-b-2 border-blue-600 bg-slate-100 px-4 text-xs font-semibold uppercase tracking-wide text-slate-800">
              <div role="columnheader" className="py-2.5 text-left">Mặt hàng</div>
              <div role="columnheader" className="py-2.5 text-center">Đơn vị</div>
              <div role="columnheader" className="py-2.5 text-center">Tồn bên xin lúc gửi</div>
              <div role="columnheader" className="py-2.5 text-center">Còn thiếu</div>
              <div role="columnheader" className="py-2.5 text-center">Tồn kho tôi</div>
              <div role="columnheader" className="py-2.5 text-center">Số cấp</div>
              <div role="columnheader" className="py-2.5 text-left">Phần chưa cấp</div>
            </div>
            <div className="scroll-hover lg:flex-1 lg:overflow-y-auto lg:overflow-x-hidden">
              {request.lines.map((line) => {
                const isOpen = line.fulfilStatus === 'PENDING' || line.fulfilStatus === 'WAITING_STOCK';
                const s = state[line.id];
                const missing = isOpen ? missingOf(line) : 0;
                const meta = REQUEST_LINE_STATUS_META[line.displayStatus];
                return (
                  <div key={line.id} role="row" style={{ gridTemplateColumns: GRID, minHeight: 56 }} className={`grid items-center gap-x-3 border-b border-slate-100 px-4 text-sm ${line.addedAfterAccept ? 'bg-amber-50/50' : ''}`}>
                    <div role="cell" className="min-w-0">
                      <p className="truncate font-semibold text-slate-900">
                        {line.drugName} <span className="text-xs font-medium text-slate-400">({line.drugCode})</span>
                      </p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        {line.addedAfterAccept && <StatusBadge tone="warning">Mới thêm</StatusBadge>}
                        {line.lineNote && <span className="truncate text-xs text-slate-500">{line.lineNote}</span>}
                      </div>
                    </div>
                    <div role="cell" className="text-center font-medium text-slate-600">{line.unitCode}</div>
                    <div role="cell" className="text-center font-medium tabular-nums text-slate-600">{line.requesterStockSnapshot ?? '—'}</div>
                    <div role="cell" className="text-center font-semibold tabular-nums text-slate-900">{isOpen ? line.remainingQty : line.requestedQty}</div>
                    <div role="cell" className="text-center font-medium tabular-nums text-slate-900">{line.supplierStock ?? '—'}</div>
                    {isOpen ? (
                      <div role="cell" className="text-center">
                        <input
                          type="number"
                          min={0}
                          max={line.remainingQty}
                          value={s?.qty ?? ''}
                          aria-label={`Số cấp ${line.drugName}`}
                          onChange={(e) => {
                            const value = e.target.value;
                            setState((prev) => ({ ...prev, [line.id]: { qty: value, remainder: prev[line.id]?.remainder ?? null } }));
                          }}
                          className="w-20 rounded-md border border-slate-300 px-1.5 py-1.5 text-center text-sm font-semibold text-slate-900 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                        />
                      </div>
                    ) : (
                      <div role="cell" className="text-center font-semibold tabular-nums text-slate-900">{line.allocatedQty}</div>
                    )}
                    <div role="cell" className="flex min-w-0 flex-wrap items-center gap-1.5 py-1.5">
                      {!isOpen && <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>}
                      {isOpen && missing === 0 && <span className="font-medium text-slate-500">Đã đủ</span>}
                      {isOpen && missing > 0 && s?.remainder && (
                        <>
                          <StatusBadge tone={s.remainder.action === 'WAIT' ? 'warning' : 'danger'}>{s.remainder.action === 'WAIT' ? `Chờ hàng về ${missing}` : `Từ chối ${missing}`}</StatusBadge>
                          <button type="button" onClick={() => setRemainderFor({ line, action: s.remainder!.action })} className="text-xs font-semibold text-blue-600 hover:underline">
                            Sửa
                          </button>
                        </>
                      )}
                      {isOpen && missing > 0 && !s?.remainder && (
                        <>
                          <button type="button" onClick={() => setRemainderFor({ line, action: 'WAIT' })} className="rounded-md bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700 ring-1 ring-inset ring-amber-300 hover:bg-amber-100">
                            Chờ hàng về
                          </button>
                          <button type="button" onClick={() => setRemainderFor({ line, action: 'REJECT' })} className="rounded-md bg-rose-50 px-2 py-1 text-xs font-semibold text-rose-700 ring-1 ring-inset ring-rose-300 hover:bg-rose-100">
                            Từ chối
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {reasonRows.length > 0 && (
        <div className="rounded-md border border-slate-200 bg-white px-3.5 py-2.5 text-[13px]">
          <p className="mb-1 font-semibold text-slate-900">Lý do cho dòng chờ hàng về hoặc bị từ chối</p>
          <ul className="space-y-0.5 text-slate-600">
            {reasonRows.map((r) => (
              <li key={r.key}>
                <span className="font-semibold text-slate-900">{r.name}:</span> {r.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && (
        <p role="alert" className="flex-shrink-0 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700">
          {error}
        </p>
      )}

      {footSlot &&
        createPortal(
          <div className="flex flex-wrap items-center justify-end gap-2">
            {showOrderButton && (
              <Button type="button" variant="secondary" onClick={() => navigate(`/inventory/purchase-orders/new?fromRequest=${request.id}`)}>
                <ShoppingCart size={16} weight="bold" aria-hidden="true" />
                Đặt NCC cho phần thiếu
              </Button>
            )}
            <Button type="button" onClick={startConfirm} loading={mutation.isPending}>
              <ArrowsLeftRight size={16} weight="bold" aria-hidden="true" />
              Chuyển thành phiếu điều chuyển
            </Button>
          </div>,
          footSlot,
        )}

      {remainderFor && (
        <RemainderDialog
          line={remainderFor.line}
          missing={missingOf(remainderFor.line)}
          initialAction={remainderFor.action}
          initial={state[remainderFor.line.id]?.remainder ?? null}
          supplyingWarehouseId={request.supplyingWarehouseId}
          currentOrderId={remainderFor.line.waitPurchaseOrderId}
          onSave={(remainder) => {
            setState((prev) => ({ ...prev, [remainderFor.line.id]: { qty: prev[remainderFor.line.id]?.qty ?? '0', remainder } }));
            setError(null);
            setRemainderFor(null);
          }}
          onClose={() => setRemainderFor(null)}
        />
      )}

      {confirming && preview && !preview.error && (
        <ConfirmDialog
          icon={ArrowsLeftRight}
          title="Chuyển thành phiếu điều chuyển"
          rows={[
            { label: 'Từ', value: request.supplyingWarehouseName, sub: request.supplyingBranchName },
            { label: 'Đến', value: request.requestingWarehouseName, sub: request.requestingBranchName },
            { label: 'Phiếu điều chuyển', value: preview.transferLineCount > 0 ? `${preview.transferLineCount} dòng, ${preview.totalQty} đơn vị` : 'Không tạo (chỉ ghi quyết định)' },
          ]}
          note="Phiếu điều chuyển được tạo ở trạng thái nháp; kho cấp chọn lô rồi Duyệt xuất."
          onClose={() => setConfirming(false)}
          actions={
            <>
              <Button type="button" variant="secondary" onClick={() => setConfirming(false)}>
                Huỷ
              </Button>
              <Button type="button" loading={mutation.isPending} onClick={() => void submit()}>
                Xác nhận
              </Button>
            </>
          }
        />
      )}
    </div>
  );
}

/** Quyết định cho phần chưa cấp của một dòng: Chờ hàng về (lý do, ngày dự kiến tuỳ chọn) hoặc Từ chối (lý do); lý do luôn bắt buộc. */
function RemainderDialog({
  line,
  missing,
  initialAction,
  initial,
  supplyingWarehouseId,
  currentOrderId,
  onSave,
  onClose,
}: {
  line: StockRequestLine;
  missing: number;
  initialAction: 'WAIT' | 'REJECT';
  initial: StockRequestRemainder | null;
  supplyingWarehouseId: string;
  currentOrderId: string | null;
  onSave: (remainder: StockRequestRemainder) => void;
  onClose: () => void;
}) {
  const canReadOrders = useHasPermission('purchase_order', 'read');
  const ordersQuery = usePurchaseOrdersQuery({ view: 'mine', limit: 50, warehouseId: supplyingWarehouseId }, canReadOrders);
  const openOrders = (ordersQuery.data?.items ?? []).filter((o) => ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED'].includes(o.status));
  const [purchaseOrderId, setPurchaseOrderId] = useState<string>(initial?.purchaseOrderId ?? currentOrderId ?? '');
  const [action, setAction] = useState<'WAIT' | 'REJECT'>(initialAction);
  const [reason, setReason] = useState(initial?.reason ?? '');
  const [expectedDate, setExpectedDate] = useState(initial?.expectedDate ?? '');
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!reason.trim()) {
      setError('Phải nhập lý do.');
      return;
    }
    onSave({ action, reason: reason.trim(), expectedDate: action === 'WAIT' && expectedDate ? expectedDate : null, purchaseOrderId: action === 'WAIT' && purchaseOrderId ? purchaseOrderId : null });
  }

  return (
    <form onSubmit={handleSubmit}>
      <ConfirmDialog
        icon={action === 'WAIT' ? CalendarCheck : Prohibit}
        tone={action === 'WAIT' ? 'primary' : 'danger'}
        title={action === 'WAIT' ? 'Chờ hàng về' : 'Từ chối phần chưa cấp'}
        rows={[
          { label: 'Mặt hàng', value: line.drugName },
          { label: 'Phần chưa cấp', value: `${missing} ${line.unitCode ?? ''}` },
        ]}
        note={action === 'WAIT' ? 'Dòng giữ mở, khi hàng về bấm "Cấp tiếp" — bên xin không phải lập lại.' : 'Bên xin thấy lý do này và dòng được đóng.'}
        error={error}
        onClose={onClose}
        actions={
          <>
            <Button type="button" variant="secondary" onClick={onClose}>
              Đóng
            </Button>
            <Button type="submit" variant={action === 'WAIT' ? 'primary' : 'danger'}>
              {action === 'WAIT' ? 'Lưu chờ hàng về' : 'Lưu từ chối'}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <div className="flex gap-2" role="group" aria-label="Cách xử lý phần chưa cấp">
            {(['WAIT', 'REJECT'] as const).map((a) => (
              <button
                key={a}
                type="button"
                aria-pressed={action === a}
                onClick={() => setAction(a)}
                className={`flex-1 rounded-md px-3 py-1.5 text-sm font-semibold ${action === a ? 'bg-blue-600 text-white' : 'bg-white text-slate-600 ring-1 ring-inset ring-slate-300 hover:bg-slate-50'}`}
              >
                {a === 'WAIT' ? 'Chờ hàng về' : 'Từ chối'}
              </button>
            ))}
          </div>
          <div>
            <label htmlFor="remainder-reason" className="mb-1 block text-sm font-semibold text-slate-800">
              Lý do <span className="text-rose-500">*</span>
            </label>
            <textarea
              id="remainder-reason"
              rows={2}
              autoFocus
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-[14px] font-normal text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
            />
          </div>
          {action === 'WAIT' && (
            <div>
              <label htmlFor="remainder-date" className="mb-1 block text-sm font-semibold text-slate-800">
                Ngày dự kiến có hàng
              </label>
              <DateInput id="remainder-date" value={expectedDate} onChange={setExpectedDate} />
            </div>
          )}
          {action === 'WAIT' && canReadOrders && openOrders.length > 0 && (
            <div>
              <p className="mb-1 block text-sm font-semibold text-slate-800">Đơn đặt hàng NCC đang chờ (tuỳ chọn)</p>
              <div className="space-y-1.5" role="radiogroup" aria-label="Đơn đặt hàng NCC đang chờ">
                {[{ id: '', label: 'Không liên kết', sub: '' }, ...openOrders.map((o) => ({ id: o.id, label: `${o.orderNo} — ${o.supplierName}`, sub: ORDER_STATUS_META[o.status].label }))].map((o) => (
                  <button
                    key={o.id || 'none'}
                    type="button"
                    role="radio"
                    aria-checked={purchaseOrderId === o.id}
                    onClick={() => setPurchaseOrderId(o.id)}
                    className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm font-semibold ${purchaseOrderId === o.id ? 'bg-brand-teal text-white' : 'bg-white text-slate-700 ring-1 ring-inset ring-slate-300 hover:bg-slate-50'}`}
                  >
                    <span className="truncate">{o.label}</span>
                    {o.sub && <span className="ml-2 flex-shrink-0 text-xs font-medium opacity-80">{o.sub}</span>}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </ConfirmDialog>
    </form>
  );
}
