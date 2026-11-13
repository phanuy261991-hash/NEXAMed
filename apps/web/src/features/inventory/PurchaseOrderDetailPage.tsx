import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Check, Package, PaperPlaneTilt, PencilSimple, Prohibit, X } from '@phosphor-icons/react';
import { ApiError } from '../../shared/api/client';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { Button } from '../../shared/ui/Button';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { ReasonConfirmDialog } from '../../shared/ui/ReasonConfirmDialog';
import { RecordLoadError } from '../../shared/ui/RecordLoadError';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { PrintButton } from '../../shared/print/PrintButton';
import { formatVnd } from '../../shared/format/currency';
import { useHasPermission } from '../auth/usePermission';
import { BaseQuantityHint } from '../drug/BaseQuantityHint';
import { unitLabel, useUnitNameByCode } from '../drug/useUnitNameByCode';
import {
  useApprovePurchaseOrderMutation,
  useCancelPurchaseOrderMutation,
  useClosePurchaseOrderMutation,
  useOrderPurchaseOrderMutation,
  usePurchaseOrderQuery,
  useRejectPurchaseOrderMutation,
  useSubmitPurchaseOrderMutation,
} from './purchase-order.queries';
import { ORDER_STEPS, orderActionsFor, orderStatusMeta, orderStepState } from './purchase-order-meta';
import { PurchaseOrderPrintView } from './PurchaseOrderPrintView';
import { formatDateTimeLongVn, formatDayVn } from './stock-request-meta';

const GRID = 'minmax(200px,1.5fr) 80px 80px 80px 80px 110px 120px';
/** Có thêm cột "Nhận đợt này" (mockup màn 9) khi người xem nhận hàng được cho đơn này. */
const GRID_RECEIVE = 'minmax(200px,1.5fr) 80px 80px 80px 80px 110px 120px 130px';

/**
 * Chi tiết "Đơn đặt hàng NCC" (docs/DECISIONS.md #298 giai đoạn 2, mockup màn 9). Nút theo trạng thái và theo phía người xem:
 *  - Chi chính (đơn cần chi nhánh chính duyệt) xem đơn Chờ duyệt của chi nhánh phụ ở chế độ chỉ xem + Duyệt/Từ chối.
 *  - Chi nhánh lập đơn: Sửa, Gửi duyệt / Duyệt, Đã gửi nhà cung cấp, Nhận hàng (mở Phiếu nhập kho điền sẵn từ đơn), Đóng đơn, Huỷ đơn.
 */
export function PurchaseOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const canCreate = useHasPermission('purchase_order', 'create');
  const canApprove = useHasPermission('purchase_order', 'approve');
  const canReceipt = useHasPermission('stock_receipt', 'create');
  const unitNameByCode = useUnitNameByCode();

  const query = usePurchaseOrderQuery(id ?? '');
  const order = query.data;
  useBreadcrumb([{ label: 'Quản lý kho' }, { label: 'Đơn đặt hàng NCC', to: '/inventory/purchase-orders' }, { label: order?.orderNo ?? 'Chi tiết' }]);

  const [dialog, setDialog] = useState<'reject' | 'cancel' | 'close' | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  // Số nhận đợt này theo từng dòng (mặc định = số còn thiếu); gửi sang Phiếu nhập kho điền sẵn qua `location.state`.
  const [receiveEdits, setReceiveEdits] = useState<Record<string, string>>({});

  const submitMutation = useSubmitPurchaseOrderMutation();
  const approveMutation = useApprovePurchaseOrderMutation();
  const rejectMutation = useRejectPurchaseOrderMutation();
  const orderMutation = useOrderPurchaseOrderMutation();
  const closeMutation = useClosePurchaseOrderMutation();
  const cancelMutation = useCancelPurchaseOrderMutation();

  function handlePrint() {
    setPrinting(true);
    setTimeout(() => {
      window.print();
      setPrinting(false);
    }, 100);
  }

  async function runAction(fn: () => Promise<unknown>, failMessage: string) {
    setActionError(null);
    try {
      await fn();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : failMessage);
    }
  }

  if (query.isPending) {
    return (
      <div className="space-y-2 p-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    );
  }
  if (query.isError || !order) {
    return <RecordLoadError error={query.error} fallbackMessage="Không tải được đơn đặt hàng." onRetry={() => void query.refetch()} fallbackTo="/inventory/purchase-orders" fallbackLabel="Về danh sách đơn" />;
  }

  const meta = orderStatusMeta(order.status, order.requiresMainApproval);
  const acts = orderActionsFor(order.status);
  const own = order.isOwnBranch;
  const approverNow = order.canActAsApprover && canApprove;
  const stepDetail = (key: (typeof ORDER_STEPS)[number]['key']): string => {
    if (key === 'APPROVED') return order.approvedAt ? formatDateTimeLongVn(order.approvedAt) : '';
    if (key === 'ORDERED') return order.orderedAt ? formatDateTimeLongVn(order.orderedAt) : '';
    if (key === 'PARTIALLY_RECEIVED') return orderStepState(order.status, key) === 'current' ? `${order.receivedLineCount}/${order.lineCount} dòng đã nhận` : '';
    return '';
  };
  const reasonText = order.rejectionReason ?? order.cancellationReason ?? order.closedReason ?? '';
  const showReceiveColumn = own && canReceipt && acts.receive;
  const grid = showReceiveColumn ? GRID_RECEIVE : GRID;
  const receiveQtyOf = (l: (typeof order.lines)[number]) => receiveEdits[l.id] ?? String(l.remainingQty);
  const receiveMap = Object.fromEntries(order.lines.filter((l) => Number(receiveQtyOf(l)) > 0).map((l) => [l.id, Number(receiveQtyOf(l))]));

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 lg:overflow-hidden">
        <h1 className="sr-only">{`Đơn đặt hàng NCC ${order.orderNo}`}</h1>

        <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-center gap-2.5">
            <h2 className="truncate text-lg font-semibold text-slate-900">{order.orderNo}</h2>
            <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
            {order.draftReceiptCount > 0 && <span className="text-sm font-medium text-slate-500">{order.draftReceiptCount} phiếu nhập đang soạn</span>}
          </div>
          <Button type="button" variant="secondary" onClick={() => navigate('/inventory/purchase-orders')}>
            ← Quay lại danh sách
          </Button>
        </div>

        {(order.status === 'APPROVED' || order.status === 'ORDERED' || order.status === 'PARTIALLY_RECEIVED' || order.status === 'RECEIVED' || order.status === 'CLOSED') && (
          <ol className="flex flex-shrink-0 flex-wrap overflow-hidden rounded-md border border-slate-200 bg-white" aria-label="Tiến trình đơn">
            {ORDER_STEPS.map((step, index) => {
              const st = orderStepState(order.status, step.key);
              const tone = st === 'current' ? 'bg-blue-600 text-white' : st === 'done' ? 'bg-emerald-50 text-emerald-800' : 'bg-white text-slate-500';
              return (
                <li key={step.key} className={`min-w-[150px] flex-1 px-3 py-2 text-[13px] ${index > 0 ? 'border-l border-slate-200' : ''} ${tone}`}>
                  <b className="block font-semibold">{step.label}</b>
                  {stepDetail(step.key)}
                </li>
              );
            })}
            {order.status === 'CLOSED' && (
              <li className="min-w-[150px] flex-1 border-l border-slate-200 bg-slate-100 px-3 py-2 text-[13px] text-slate-700">
                <b className="block font-semibold">{meta.label}</b>
                {reasonText}
              </li>
            )}
          </ol>
        )}
        {(order.status === 'REJECTED' || order.status === 'CANCELLED') && (
          <div role="status" className="flex-shrink-0 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-900">
            <strong>{meta.label}:</strong> {reasonText}
          </div>
        )}
        {order.status === 'PENDING_APPROVAL' && (
          <div role="status" className="flex-shrink-0 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            {own ? (order.requiresMainApproval ? 'Đơn đang chờ chi nhánh chính duyệt.' : 'Đơn đang chờ người có quyền duyệt của chi nhánh.') : 'Đơn của chi nhánh khác đang chờ chi nhánh chính duyệt.'}
          </div>
        )}
        {actionError && <ErrorBanner message={actionError} onRetry={() => setActionError(null)} />}

        <dl className="grid flex-shrink-0 grid-cols-2 gap-x-6 gap-y-2 rounded-md border border-slate-200 bg-white px-4 py-3 sm:grid-cols-3 lg:grid-cols-6" aria-label="Thông tin đơn">
          <Info label="Nhà cung cấp" value={order.supplierName} />
          <Info label="Kho nhận" value={`${order.warehouseName}${order.branchName ? ` — ${order.branchName}` : ''}`} />
          <Info label="Người lập" value={order.createdByName} />
          <Info label="Giao dự kiến" value={order.expectedDate ? formatDayVn(order.expectedDate) : '—'} />
          <Info label="Tổng dự kiến" value={order.totalAmount > 0 ? `${formatVnd(order.totalAmount)} đ` : '—'} />
          <Info label="Điều khoản" value={order.note || '—'} />
        </dl>

        <div className="grid gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_320px] lg:grid-rows-[minmax(0,1fr)]">
          <div className="overflow-hidden rounded-md border border-slate-200 bg-white lg:min-h-0">
            <div role="table" aria-label="Các dòng của đơn" className="scroll-hover overflow-x-auto lg:h-full">
              <div className="flex flex-col lg:h-full" style={{ minWidth: showReceiveColumn ? 900 : 760 }}>
                <div role="row" style={{ gridTemplateColumns: grid }} className="grid gap-x-4 border-b-2 border-blue-600 bg-slate-100 px-4 text-xs font-semibold uppercase tracking-wide text-slate-800">
                  <div role="columnheader" className="py-2.5 text-left">Mặt hàng</div>
                  <div role="columnheader" className="py-2.5 text-center">Đơn vị</div>
                  <div role="columnheader" className="py-2.5 text-center">Đã đặt</div>
                  <div role="columnheader" className="py-2.5 text-center">Đã nhận</div>
                  <div role="columnheader" className="py-2.5 text-center">Còn thiếu</div>
                  <div role="columnheader" className="py-2.5 text-center">Đơn giá</div>
                  <div role="columnheader" className="py-2.5 text-center">Thành tiền</div>
                  {showReceiveColumn && <div role="columnheader" className="py-2.5 text-center">Nhận đợt này</div>}
                </div>
                <div className="scroll-hover lg:flex-1 lg:overflow-y-auto lg:overflow-x-hidden">
                  {order.lines.map((l) => (
                    <div key={l.id} role="row" style={{ gridTemplateColumns: grid, minHeight: 56 }} className="grid items-center gap-x-4 border-b border-slate-100 px-4 py-2 text-sm">
                      <div role="cell" className="min-w-0">
                        <p className="truncate font-semibold text-slate-900">{l.drugName}</p>
                        {l.sourceRequests.length > 0 && <p className="truncate text-xs text-slate-500">Chờ hàng của {l.sourceRequests.map((r) => r.requestNo).join(', ')}</p>}
                        {l.lineNote && <p className="truncate text-xs text-slate-500">{l.lineNote}</p>}
                      </div>
                      <div role="cell" className="text-center font-medium text-slate-600">{unitLabel(unitNameByCode, l.unitCode)}</div>
                      <div role="cell" className="text-center font-semibold tabular-nums text-slate-900">
                        {l.quantity}
                        <BaseQuantityHint drugId={l.drugId} unitCode={l.unitCode} quantity={l.quantity} />
                      </div>
                      <div role="cell" className="text-center font-medium tabular-nums text-slate-900">{l.receivedQty}</div>
                      <div role="cell" className="text-center font-medium tabular-nums text-slate-900">{l.remainingQty}</div>
                      <div role="cell" className="text-center font-medium tabular-nums text-slate-600">{l.expectedUnitCost !== null ? formatVnd(l.expectedUnitCost) : '—'}</div>
                      <div role="cell" className="text-center font-medium tabular-nums text-slate-900">{l.expectedUnitCost !== null ? formatVnd(l.lineAmount) : '—'}</div>
                      {showReceiveColumn && (
                        <div role="cell" className="text-center">
                          {l.remainingQty === 0 && !order.allowOverReceipt ? (
                            <span className="font-medium text-slate-400">Đã đủ</span>
                          ) : (
                            <input
                              type="number"
                              min={0}
                              value={receiveQtyOf(l)}
                              aria-label={`Nhận đợt này ${l.drugName}`}
                              onChange={(e) => setReceiveEdits((prev) => ({ ...prev, [l.id]: e.target.value }))}
                              className="w-20 rounded-md border border-slate-300 px-1.5 py-1.5 text-center text-sm font-semibold text-slate-900 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                            />
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="flex min-w-0 flex-col gap-2.5 lg:min-h-0 lg:overflow-y-auto">
            <section className="rounded-md border border-slate-200 bg-white px-3.5 py-3" aria-label="Phiếu nhập liên kết">
              <h3 className="mb-2 text-[15px] font-semibold text-slate-900">Phiếu nhập liên kết</h3>
              {order.receipts.length === 0 ? (
                <p className="text-[13px] text-slate-500">Chưa có phiếu nhập nào.</p>
              ) : (
                <ul className="space-y-2.5">
                  {order.receipts.map((r, i) => (
                    <li key={r.id} className="text-[13px]">
                      <p className="flex flex-wrap items-center gap-1.5">
                        <strong className="text-slate-900">{r.receiptNo}</strong>
                        <StatusBadge tone={r.voided ? 'neutral' : r.status === 'POSTED' ? 'success' : r.status === 'REJECTED' ? 'danger' : 'neutral'}>{r.voided ? 'Đã huỷ' : r.status === 'POSTED' ? 'Đã duyệt' : r.status === 'REJECTED' ? 'Từ chối' : 'Nháp'}</StatusBadge>
                        {own && (
                          <Link to={`/inventory/receipts/${r.id}`} className="ml-auto text-xs font-semibold text-blue-600 hover:underline">
                            Mở phiếu
                          </Link>
                        )}
                      </p>
                      <p className="text-xs text-slate-500">
                        Đợt {i + 1}, {formatDayVn(r.occurredAt.slice(0, 10))}, {r.lineCount} dòng
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            {acts.receive && own && (
              <div role="status" className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-[13px] text-emerald-900">
                Sau khi duyệt phiếu nhập, yêu cầu cấp hàng đang chờ đơn này sẽ hiện nhãn <strong>Hàng đã về</strong> để kho cấp bấm &quot;Cấp tiếp&quot;.
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="flex flex-shrink-0 flex-wrap items-center gap-2 border-t border-slate-200 bg-white px-4 py-3">
        {own && (
          <PrintButton documentType="PURCHASE_ORDER" onPrint={handlePrint}>
            In đơn đặt hàng
          </PrintButton>
        )}
        {own && canCreate && acts.cancel && (
          <Button type="button" variant="dangerGhost" onClick={() => setDialog('cancel')}>
            <X size={16} weight="bold" aria-hidden="true" />
            Huỷ đơn
          </Button>
        )}
        {own && canCreate && acts.close && (
          <Button type="button" variant="secondary" onClick={() => setDialog('close')}>
            Đóng đơn (NCC không giao nữa)
          </Button>
        )}
        {approverNow && acts.reject && (
          <Button type="button" variant="dangerGhost" onClick={() => setDialog('reject')}>
            <Prohibit size={16} weight="bold" aria-hidden="true" />
            Từ chối
          </Button>
        )}
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {own && canCreate && acts.edit && (
            <Button type="button" variant="secondary" onClick={() => navigate(`/inventory/purchase-orders/${order.id}/edit`)}>
              <PencilSimple size={16} weight="bold" aria-hidden="true" />
              {order.status === 'REJECTED' ? 'Sửa và gửi lại' : 'Sửa đơn'}
            </Button>
          )}
          {own && canCreate && acts.submit && (order.requiresMainApproval || !canApprove) && (
            <Button type="button" loading={submitMutation.isPending} onClick={() => void runAction(() => submitMutation.mutateAsync({ id: order.id, body: { version: order.version } }), 'Gửi duyệt thất bại, vui lòng thử lại.')}>
              <PaperPlaneTilt size={16} weight="bold" aria-hidden="true" />
              {order.requiresMainApproval ? 'Gửi chi nhánh chính duyệt' : 'Gửi duyệt'}
            </Button>
          )}
          {approverNow && acts.approve && (
            <Button type="button" loading={approveMutation.isPending} onClick={() => void runAction(() => approveMutation.mutateAsync({ id: order.id, body: { version: order.version } }), 'Duyệt thất bại, vui lòng thử lại.')}>
              <Check size={16} weight="bold" aria-hidden="true" />
              Duyệt đơn
            </Button>
          )}
          {own && canCreate && acts.order && (
            <Button type="button" loading={orderMutation.isPending} onClick={() => void runAction(() => orderMutation.mutateAsync({ id: order.id, body: { version: order.version } }), 'Không đánh dấu đã gửi nhà cung cấp được, vui lòng thử lại.')}>
              <PaperPlaneTilt size={16} weight="bold" aria-hidden="true" />
              Đã gửi nhà cung cấp
            </Button>
          )}
          {own && canReceipt && acts.receive && (
            <Button type="button" disabled={Object.keys(receiveMap).length === 0} onClick={() => navigate(`/inventory/receipts/new?fromOrder=${order.id}`, { state: { receiveQty: receiveMap } })}>
              <Package size={16} weight="bold" aria-hidden="true" />
              Nhận hàng, lập Phiếu nhập kho
            </Button>
          )}
        </div>
      </div>

      {dialog === 'cancel' && (
        <ReasonConfirmDialog
          title="Huỷ đơn đặt hàng NCC"
          rows={[{ label: 'Đơn', value: order.orderNo }]}
          note="Các yêu cầu cấp hàng đang chờ đơn này sẽ được gỡ liên kết."
          confirmLabel="Xác nhận huỷ"
          confirmVariant="danger"
          onConfirm={(reason) => cancelMutation.mutateAsync({ id: order.id, body: { reason, version: order.version } })}
          onDone={() => setDialog(null)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'close' && (
        <ReasonConfirmDialog
          title="Đóng đơn đặt hàng NCC"
          rows={[{ label: 'Đơn', value: order.orderNo }]}
          note="Phần còn thiếu sẽ không nhận nữa. Hàng đã nhận giữ nguyên."
          confirmLabel="Xác nhận đóng đơn"
          confirmVariant="danger"
          onConfirm={(reason) => closeMutation.mutateAsync({ id: order.id, body: { reason, version: order.version } })}
          onDone={() => setDialog(null)}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog === 'reject' && (
        <ReasonConfirmDialog
          title="Từ chối đơn đặt hàng NCC"
          rows={[{ label: 'Đơn', value: order.orderNo }]}
          note="Chi nhánh lập đơn thấy lý do này và có thể sửa rồi gửi lại."
          confirmLabel="Xác nhận từ chối"
          confirmVariant="danger"
          onConfirm={(reason) => rejectMutation.mutateAsync({ id: order.id, body: { reason, version: order.version } })}
          onDone={() => setDialog(null)}
          onClose={() => setDialog(null)}
        />
      )}
      {printing && <PurchaseOrderPrintView order={order} />}
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-slate-500">{label}</dt>
      <dd className="break-words text-sm font-semibold text-slate-900">{value}</dd>
    </div>
  );
}
