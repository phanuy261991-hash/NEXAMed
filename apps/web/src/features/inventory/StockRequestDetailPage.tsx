import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowUUpLeft, Check, ChatText, Eye, ListPlus, PencilSimple, Prohibit, X } from '@phosphor-icons/react';
import type { StockRequestDetail, StockRequestLine } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { Button } from '../../shared/ui/Button';
import { ConfirmDialog } from '../../shared/ui/ConfirmDialog';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { ReasonConfirmDialog } from '../../shared/ui/ReasonConfirmDialog';
import { RecordLoadError } from '../../shared/ui/RecordLoadError';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { PrintButton } from '../../shared/print/PrintButton';
import { useHasPermission } from '../auth/usePermission';
import { showBranchInfo } from '../branch/branch-visibility';
import { useAuthStore } from '../auth/auth.store';
import {
  useAcceptStockRequestMutation,
  useAcknowledgeStockRequestUpdateMutation,
  useCancelStockRequestMutation,
  useEscalateStockRequestMutation,
  useRejectStockRequestMutation,
  useStockRequestQuery,
} from './stock-request.queries';
import { useResolveWithdrawRequestsMutation } from './purchase-order.queries';
import {
  formatDateTimeLongVn,
  formatDayVn,
  formatEventTime,
  REQUEST_LINE_STATUS_META,
  REQUEST_STATUS_META,
  REQUEST_STEPS,
  requesterActionsFor,
  stepState,
  summarizeRequesterUpdates,
  supplierActionsFor,
} from './stock-request-meta';
import { StockRequestAddLinesDialog, StockRequestNoteDialog, StockRequestWithdrawDialog } from './StockRequestDialogs';
import { StockRequestPrintView } from './StockRequestPrintView';
import { StockRequestProcessPanel } from './StockRequestProcessPanel';
import { StockRequestTransferResult } from './StockRequestTransferResult';

const REQUESTER_GRID = 'minmax(190px,1.4fr) 70px 70px 80px minmax(240px,1.6fr)';

/**
 * Chi tiết "Yêu cầu cấp hàng" (docs/DECISIONS.md #298, mockup màn 5/6/6b). MỘT trang dùng cho cả hai bên, chọn giao diện theo người xem:
 *  - KHO CẤP (`canActAsSupplier`): Tiếp nhận / Từ chối cả phiếu; sau khi tiếp nhận có khối xử lý từng dòng ("Chuyển thành phiếu điều chuyển", "Xin phần thiếu"), nhãn "Có cập nhật mới" của bên xin.
 *  - BÊN XIN (`canActAsRequester`): theo dõi trạng thái từng dòng, kiểm nhận phiếu điều chuyển, nhắn bổ sung / đổi mức khẩn / thêm mặt hàng / rút dòng / huỷ theo ma trận trạng thái.
 * Diễn biến và phiếu điều chuyển liên kết hiện cho cả hai bên.
 */
export function StockRequestDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const user = useAuthStore((s) => s.user);
  const multiBranch = showBranchInfo(user);
  const canCreate = useHasPermission('stock_request', 'create');
  const canApprove = useHasPermission('stock_request', 'approve');

  const query = useStockRequestQuery(id ?? '');
  const request = query.data;

  useBreadcrumb([{ label: 'Quản lý kho' }, { label: 'Yêu cầu cấp hàng', to: '/inventory/requests' }, { label: request?.requestNo ?? 'Chi tiết' }]);

  const [noteMode, setNoteMode] = useState<'message' | 'priority' | null>(null);
  const [addingLines, setAddingLines] = useState(false);
  const [withdrawIds, setWithdrawIds] = useState<string[] | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [escalating, setEscalating] = useState(false);
  /** Phiếu điều chuyển nháp vừa tạo từ "Chuyển thành phiếu điều chuyển" — hiện hộp kết quả (mockup màn 5b). Giữ ở trang vì khối xử lý được dựng lại sau mỗi lần cấp. */
  const [createdTransferId, setCreatedTransferId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [printing, setPrinting] = useState(false);
  const [footSlot, setFootSlot] = useState<HTMLDivElement | null>(null);

  const acceptMutation = useAcceptStockRequestMutation();
  const ackMutation = useAcknowledgeStockRequestUpdateMutation();
  const cancelMutation = useCancelStockRequestMutation();
  const rejectMutation = useRejectStockRequestMutation();

  // Từ danh sách bấm "Thêm hàng" mở thẳng hộp thêm mặt hàng.
  const wantsAdd = searchParams.get('thao-tac') === 'them-hang';
  useEffect(() => {
    if (wantsAdd && request && canCreate && request.canActAsRequester && requesterActionsFor(request.status).addLines) {
      setAddingLines(true);
      setSearchParams({}, { replace: true });
    }
  }, [wantsAdd, request, canCreate, setSearchParams]);

  function handlePrint() {
    setPrinting(true);
    setTimeout(() => {
      window.print();
      setPrinting(false);
    }, 100);
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
  if (query.isError || !request) {
    return <RecordLoadError error={query.error} fallbackMessage="Không tải được phiếu yêu cầu cấp hàng." onRetry={() => void query.refetch()} fallbackTo="/inventory/requests" fallbackLabel="Về danh sách yêu cầu" />;
  }

  const meta = REQUEST_STATUS_META[request.status];
  const requesterActs = requesterActionsFor(request.status);
  const supplierActs = supplierActionsFor(request.status);
  const asRequester = request.canActAsRequester && canCreate;
  const asSupplier = request.canActAsSupplier && canApprove;
  const showProcess = asSupplier && supplierActs.allocate;
  const place = (branch: string, warehouse: string) => (multiBranch ? `${branch} / ${warehouse}` : warehouse);
  const backToList = () => navigate('/inventory/requests');

  async function runAction(fn: () => Promise<unknown>, failMessage: string) {
    setActionError(null);
    try {
      await fn();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : failMessage);
    }
  }

  const waitingLineIds = request.lines.filter((l) => l.fulfilStatus === 'WAITING_STOCK').map((l) => l.id);
  const withdrawableIds = request.lines.filter((l) => (requesterActs.withdrawOnlyWaiting ? l.fulfilStatus === 'WAITING_STOCK' : l.fulfilStatus === 'PENDING' || l.fulfilStatus === 'WAITING_STOCK')).map((l) => l.id);
  const canEscalateNow = asSupplier && request.canEscalate && supplierActs.allocate && request.lines.some((l) => (l.fulfilStatus === 'PENDING' || l.fulfilStatus === 'WAITING_STOCK') && l.remainingQty > 0 && l.waitChildRequestId === null);

  const lineCountAllocated = request.lines.filter((l) => l.allocatedQty > 0).length;
  const closedWithoutProgress = request.status === 'REJECTED' || request.status === 'CANCELLED' || request.status === 'WITHDRAWN';
  const stepDetail = (key: (typeof REQUEST_STEPS)[number]['key']): string => {
    if (key === 'SUBMITTED') return request.submittedAt ? formatDateTimeLongVn(request.submittedAt) : '';
    if (key === 'ACCEPTED') return request.acceptedAt ? formatEventTime(request.acceptedAt) : '';
    if (key === 'IN_PROGRESS') {
      const waiting = request.lines.filter((l) => l.displayStatus === 'WAITING_STOCK').length;
      return stepState(request.status, 'IN_PROGRESS') === 'current' ? `${lineCountAllocated}/${request.lines.length} dòng đã cấp${waiting > 0 ? `, ${waiting} dòng chờ hàng về` : ''}` : '';
    }
    return request.completedAt ? formatEventTime(request.completedAt) : '';
  };

  // Diễn biến (mockup màn 6): các mốc đã xảy ra, rồi mốc "Chờ hàng về" đang mở và mốc "Cấp tiếp khi hàng về" chưa tới.
  const waitingLines = request.lines.filter((l) => l.fulfilStatus === 'WAITING_STOCK');
  const earliestExpected = waitingLines.map((l) => l.waitExpectedDate).filter((d): d is string => Boolean(d)).sort()[0] ?? null;
  const timeline: { key: string; tone: 'ok' | 'wait' | 'no' | 'todo'; title: string; sub: string }[] = request.events.map((e) => ({
    key: e.id,
    tone: ['rejected', 'cancelled', 'transfer_rejected', 'transfer_receive_rejected'].includes(e.eventType) ? 'no' : 'ok',
    title: e.message ?? '',
    sub: `${formatEventTime(e.occurredAt)}, ${e.detail ?? (e.eventType === 'accepted' ? `${e.actorName} (kho cấp)` : e.actorName)}`,
  }));
  if (waitingLines.length > 0 && !['COMPLETED', 'REJECTED', 'CANCELLED', 'WITHDRAWN'].includes(request.status)) {
    timeline.push({ key: 'wait', tone: 'wait', title: `Chờ hàng về: ${waitingLines.map((l) => l.drugName).join(', ')}`, sub: earliestExpected ? `Dự kiến ${formatDayVn(earliestExpected).slice(0, 5)}` : 'Chưa có ngày dự kiến' });
    timeline.push({ key: 'next', tone: 'todo', title: 'Cấp tiếp khi hàng về', sub: request.readyToSupply ? 'Hàng đã về' : 'Chưa tới' });
  }

  const requesterFoot = asRequester;
  const requesterUpdate = summarizeRequesterUpdates(request.events);

  const footButtons = (
    <>
              <PrintButton documentType="STOCK_REQUEST" onPrint={handlePrint}>
                In phiếu
              </PrintButton>
              {requesterActs.message && (
                <Button type="button" variant="secondary" onClick={() => setNoteMode('message')}>
                  <ChatText size={16} weight="bold" aria-hidden="true" />
                  Nhắn bổ sung
                </Button>
              )}
              {requesterActs.message && (
                <Button type="button" variant="secondary" onClick={() => setNoteMode('priority')}>
                  Đổi mức khẩn
                </Button>
              )}
              {request.status !== 'DRAFT' && ['SUBMITTED', 'ACCEPTED', 'IN_PROGRESS'].includes(request.status) && (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={!requesterActs.addLines}
                  title={requesterActs.addLines ? undefined : 'Phiếu đã có dòng được cấp, muốn xin thêm hãy lập phiếu mới'}
                  onClick={() => setAddingLines(true)}
                >
                  <ListPlus size={16} weight="bold" aria-hidden="true" />
                  Thêm mặt hàng
                </Button>
              )}
              {requesterActs.withdrawLines && request.status !== 'SUBMITTED' && request.status !== 'DRAFT' && (requesterActs.withdrawOnlyWaiting ? waitingLineIds : withdrawableIds).length > 0 && (
                <Button type="button" variant="amberSolid" onClick={() => setWithdrawIds(requesterActs.withdrawOnlyWaiting ? waitingLineIds : withdrawableIds)}>
                  {requesterActs.withdrawOnlyWaiting ? 'Rút các dòng đang chờ' : 'Rút các dòng chưa có hàng'}
                </Button>
              )}
    </>
  );

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 lg:overflow-hidden">
      <h1 className="sr-only">{`Phiếu yêu cầu cấp hàng ${request.requestNo}`}</h1>

      <div className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          <h2 className="truncate text-lg font-semibold text-slate-900">{request.requestNo}</h2>
          <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
          {request.priority === 'URGENT' && <StatusBadge tone="danger">Khẩn</StatusBadge>}
          {asSupplier && request.readyToSupply && <StatusBadge tone="success">Hàng đã về</StatusBadge>}
          {request.parentRequestNo && <span className="text-sm font-medium text-slate-500">Xin phần thiếu của {request.parentRequestNo}</span>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {asSupplier && supplierActs.accept && (
            <Button type="button" loading={acceptMutation.isPending} onClick={() => void runAction(() => acceptMutation.mutateAsync({ id: request.id, body: { version: request.version } }), 'Tiếp nhận thất bại, vui lòng thử lại.')}>
              <Check size={16} weight="bold" aria-hidden="true" />
              Tiếp nhận
            </Button>
          )}
          {asSupplier && supplierActs.rejectAll && (
            <Button type="button" variant="dangerGhost" onClick={() => setRejecting(true)}>
              <Prohibit size={16} weight="bold" aria-hidden="true" />
              Từ chối cả phiếu
            </Button>
          )}
          {canEscalateNow && (
            <Button type="button" variant="info" onClick={() => setEscalating(true)}>
              <ArrowUUpLeft size={16} weight="bold" className="rotate-90" aria-hidden="true" />
              Xin phần thiếu lên cấp trên
            </Button>
          )}
          {asRequester && requesterActs.edit && (
            <Button type="button" variant="secondary" onClick={() => navigate(`/inventory/requests/${request.id}/edit`)}>
              <PencilSimple size={16} weight="bold" aria-hidden="true" />
              Sửa phiếu
            </Button>
          )}
          {asRequester && requesterActs.cancel && (
            <Button type="button" variant="dangerGhost" onClick={() => setCancelling(true)}>
              <X size={16} weight="bold" aria-hidden="true" />
              Huỷ phiếu
            </Button>
          )}
          {!requesterFoot && (
            <PrintButton documentType="STOCK_REQUEST" onPrint={handlePrint}>
              In phiếu
            </PrintButton>
          )}
          <Button type="button" variant="secondary" onClick={backToList}>
            ← Quay lại danh sách
          </Button>
        </div>
      </div>

      {/* Bên xin vừa cập nhật (mockup màn 5): dải vàng nằm TRÊN dải các bước, nói rõ bên xin vừa thêm/rút gì */}
      {asSupplier && request.supplierUpdatePending && (
        <div role="status" className="flex flex-shrink-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span>
            <strong>Bên xin vừa cập nhật phiếu</strong>
            {requesterUpdate ? ` lúc ${formatEventTime(requesterUpdate.at)}: ${requesterUpdate.text}.` : '.'} Xem dòng có nhãn &quot;Mới thêm&quot; rồi bấm
          </span>
          <Button type="button" variant="amber" className="px-3 py-1" loading={ackMutation.isPending} onClick={() => void runAction(() => ackMutation.mutateAsync(request.id), 'Không đánh dấu đã xem được, vui lòng thử lại.')}>
            <Eye size={16} weight="bold" aria-hidden="true" />
            Đã xem cập nhật
          </Button>
          <span>hoặc cứ tiếp tục xử lý.</span>
        </div>
      )}

      {/* Các bước (mockup màn 6): MỘT dải liền, bước đã qua nền xanh lá, bước hiện tại nền xanh đặc */}
      {request.status !== 'DRAFT' && (
        <ol className="flex flex-shrink-0 flex-wrap overflow-hidden rounded-md border border-slate-200 bg-white" aria-label="Tiến trình phiếu">
          {(closedWithoutProgress ? REQUEST_STEPS.slice(0, 1) : REQUEST_STEPS).map((step, index) => {
            const st = stepState(request.status, step.key);
            const tone = st === 'current' ? 'bg-blue-600 text-white' : st === 'done' ? 'bg-emerald-50 text-emerald-800' : 'bg-white text-slate-500';
            return (
              <li key={step.key} className={`min-w-[150px] flex-1 px-3 py-2 text-[13px] ${index > 0 ? 'border-l border-slate-200' : ''} ${tone}`}>
                <b className="block font-semibold">{step.label}</b>
                {stepDetail(step.key)}
              </li>
            );
          })}
          {closedWithoutProgress && (
            <li className="min-w-[150px] flex-1 border-l border-slate-200 bg-rose-50 px-3 py-2 text-[13px] text-rose-800">
              <b className="block font-semibold">{meta.label}</b>
              {request.rejectionReason ?? request.cancellationReason ?? ''}
            </li>
          )}
        </ol>
      )}

      {actionError && <ErrorBanner message={actionError} onRetry={() => setActionError(null)} />}
      {asSupplier && request.lines.some((l) => l.withdrawRequestedAt) && <WithdrawRequestNotice request={request} onError={setActionError} />}

      <div className="grid gap-3 lg:min-h-0 lg:flex-1 lg:grid-cols-[minmax(0,1fr)_320px] lg:grid-rows-[minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-2.5 lg:min-h-0">
          {showProcess ? (
            <StockRequestProcessPanel key={`${request.id}-${request.version}`} request={request} footSlot={footSlot} onTransferCreated={setCreatedTransferId} />
          ) : (
            <RequesterTable
              request={request}
              canWithdraw={asRequester && requesterActs.withdrawLines && request.status !== 'DRAFT' && request.status !== 'SUBMITTED'}
              withdrawOnlyWaiting={requesterActs.withdrawOnlyWaiting}
              onWithdraw={(ids) => setWithdrawIds(ids)}
            />
          )}

        </div>

        <div className="flex min-w-0 flex-col gap-2.5 lg:min-h-0 lg:overflow-y-auto">

          {/* "Thông tin phiếu" (mockup màn 5) ở cột phải thay cho dải thông tin ngang trước đây */}
          <section className="rounded-md border border-slate-200 bg-white px-3.5 py-3" aria-label="Thông tin phiếu">
            <h3 className="mb-2 text-[15px] font-semibold text-slate-900">Thông tin phiếu</h3>
            <dl className="grid grid-cols-[76px_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
              <dt className="text-slate-500">Từ</dt>
              <dd className="break-words font-semibold text-slate-900">{place(request.requestingBranchName, request.requestingWarehouseName)}</dd>
              <dt className="text-slate-500">Đến</dt>
              <dd className="break-words font-semibold text-slate-900">{place(request.supplyingBranchName, request.supplyingWarehouseName)}</dd>
              <dt className="text-slate-500">Người xin</dt>
              <dd className="break-words font-semibold text-slate-900">{request.createdByName}</dd>
              <dt className="text-slate-500">Mức khẩn</dt>
              <dd>{request.priority === 'URGENT' ? <StatusBadge tone="danger">Khẩn</StatusBadge> : <StatusBadge tone="neutral">Thường</StatusBadge>}</dd>
              <dt className="text-slate-500">Cần hàng</dt>
              <dd className="font-semibold text-slate-900">{request.neededBy ? formatDayVn(request.neededBy) : '—'}</dd>
              <dt className="text-slate-500">Ghi chú</dt>
              <dd className="break-words font-semibold text-slate-900">{request.note || '—'}</dd>
            </dl>
            {showProcess && (
              <p className="mt-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
                Bấm &quot;Chuyển thành phiếu điều chuyển&quot; sẽ tạo <b>1 Phiếu điều chuyển nháp</b> mang sẵn mặt hàng và số lượng ở cột &quot;Số cấp&quot;, không phải lập lại. Phần chờ hàng về được giữ mở, không phải lập lại yêu cầu.
              </p>
            )}
          </section>

          <section className="rounded-md border border-slate-200 bg-white px-3.5 py-3" aria-label="Diễn biến">
            <h3 className="mb-2 text-[15px] font-semibold text-slate-900">Diễn biến</h3>
            <ul>
              {timeline.map((item, index) => (
                <li key={item.key} className={`relative ml-[5px] border-l-2 pl-4 text-[13px] text-slate-900 ${index === timeline.length - 1 ? 'border-l-transparent pb-0' : 'border-slate-200 pb-3'}`}>
                  <span className={`absolute -left-[6px] top-[3px] h-2.5 w-2.5 rounded-full ${item.tone === 'ok' ? 'bg-emerald-500' : item.tone === 'wait' ? 'bg-amber-500' : item.tone === 'no' ? 'bg-rose-600' : 'bg-slate-300'}`} aria-hidden="true" />
                  {item.title}
                  <span className="block text-xs text-slate-500">{item.sub}</span>
                </li>
              ))}
            </ul>
          </section>

          {request.transfers.length > 0 && (
            <section className="rounded-md border border-slate-200 bg-white px-3.5 py-3" aria-label="Phiếu điều chuyển liên kết">
              <h3 className="mb-2 text-[15px] font-semibold text-slate-900">Phiếu điều chuyển liên kết</h3>
              <ul className="space-y-2.5">
                {request.transfers.map((t) => (
                  <li key={t.id} className="text-[13px]">
                    <p className="flex flex-wrap items-center gap-1.5">
                      <strong className="text-slate-900">{t.transferNo}</strong>
                      <StatusBadge tone={t.status === 'COMPLETED' ? 'success' : t.status === 'IN_TRANSIT' ? 'info' : t.status === 'DRAFT' ? 'neutral' : 'warning'}>{TRANSFER_LABEL[t.status]}</StatusBadge>
                      {t.canOpen && (
                        <Link to={`/inventory/transfers/${t.id}`} className="ml-auto text-xs font-semibold text-blue-600 hover:underline">
                          {t.status === 'IN_TRANSIT' && request.canActAsRequester ? 'Kiểm nhận' : 'Mở phiếu'}
                        </Link>
                      )}
                    </p>
                    <p className="text-xs text-slate-500">
                      {t.fromWarehouseName} → {t.toWarehouseName}, {t.lineCount} dòng
                      {!t.canOpen && ' · kho cấp đang soạn'}
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>

      </div>

      {(requesterFoot || showProcess) && (
        <div className="flex flex-shrink-0 flex-wrap items-center gap-2 border-t border-slate-200 bg-white px-4 py-3">
          {requesterFoot && footButtons}
          <div ref={setFootSlot} className="ml-auto" />
        </div>
      )}

      {noteMode && <StockRequestNoteDialog request={request} mode={noteMode} onClose={() => setNoteMode(null)} />}
      {addingLines && <StockRequestAddLinesDialog request={request} onClose={() => setAddingLines(false)} />}
      {withdrawIds && <StockRequestWithdrawDialog request={request} lineIds={withdrawIds} onClose={() => setWithdrawIds(null)} />}
      {cancelling && (
        <ReasonConfirmDialog
          title="Huỷ phiếu yêu cầu cấp hàng"
          rows={[{ label: 'Phiếu', value: request.requestNo }]}
          note="Kho cấp chưa tiếp nhận nên huỷ được."
          confirmLabel="Xác nhận huỷ"
          confirmVariant="danger"
          onConfirm={(reason) => cancelMutation.mutateAsync({ id: request.id, body: { reason, version: request.version } })}
          onDone={() => setCancelling(false)}
          onClose={() => setCancelling(false)}
        />
      )}
      {rejecting && (
        <ReasonConfirmDialog
          title="Từ chối cả phiếu"
          rows={[{ label: 'Phiếu', value: request.requestNo }]}
          note="Bên xin thấy lý do này."
          confirmLabel="Xác nhận từ chối"
          confirmVariant="danger"
          onConfirm={(reason) => rejectMutation.mutateAsync({ id: request.id, body: { reason, version: request.version } })}
          onDone={() => setRejecting(false)}
          onClose={() => setRejecting(false)}
        />
      )}
      {escalating && <EscalateDialog request={request} onClose={() => setEscalating(false)} />}
      {createdTransferId && <StockRequestTransferResult transferId={createdTransferId} request={request} onClose={() => setCreatedTransferId(null)} />}
      {printing && <StockRequestPrintView request={request} />}
    </div>
  );
}

const TRANSFER_LABEL: Record<StockRequestDetail['transfers'][number]['status'], string> = {
  DRAFT: 'Nháp',
  IN_TRANSIT: 'Đang giao',
  COMPLETED: 'Hoàn thành',
  REJECTED: 'Từ chối',
  VARIANCE_PENDING: 'Nhận thiếu',
  RETURNING: 'Đang trả về',
  RETURNED: 'Đã trả về',
};

/** Bảng theo dõi từng dòng cho bên xin (mockup màn 6): số xin/đã cấp/còn thiếu căn giữa, "Trạng thái dòng" gồm nhãn + nút Kiểm nhận/Rút dòng ngay cạnh + dòng phụ lý do/phiếu điều chuyển. */
function RequesterTable({
  request,
  canWithdraw,
  withdrawOnlyWaiting,
  onWithdraw,
}: {
  request: StockRequestDetail;
  canWithdraw: boolean;
  withdrawOnlyWaiting: boolean;
  onWithdraw: (lineIds: string[]) => void;
}) {
  const navigate = useNavigate();
  return (
    <div className="overflow-hidden rounded-md border border-slate-200 bg-white lg:min-h-0 lg:flex-1">
      <div role="table" aria-label="Các dòng của phiếu" className="scroll-hover overflow-x-auto lg:h-full">
        <div className="flex flex-col lg:h-full" style={{ minWidth: 640 }}>
          <div role="row" style={{ gridTemplateColumns: REQUESTER_GRID }} className="grid gap-x-4 border-b-2 border-blue-600 bg-slate-100 px-4 text-xs font-semibold uppercase tracking-wide text-slate-800">
            <div role="columnheader" className="py-2.5 text-left">Mặt hàng</div>
            <div role="columnheader" className="py-2.5 text-center">Số xin</div>
            <div role="columnheader" className="py-2.5 text-center">Đã cấp</div>
            <div role="columnheader" className="py-2.5 text-center">Còn thiếu</div>
            <div role="columnheader" className="py-2.5 text-left">Trạng thái dòng</div>
          </div>
          <div className="scroll-hover lg:flex-1 lg:overflow-y-auto lg:overflow-x-hidden">
          {request.lines.map((line: StockRequestLine) => {
            const meta = REQUEST_LINE_STATUS_META[line.displayStatus];
            const sub = [
              line.decisionReason ?? line.withdrawReason,
              line.waitExpectedDate ? `Dự kiến ${formatDayVn(line.waitExpectedDate).slice(0, 5)}` : null,
              line.waitChildRequestNo ? `Đã xin cấp trên: ${line.waitChildRequestNo}` : null,
              line.waitPurchaseOrderNo ? `Đang chờ đơn ${line.waitPurchaseOrderNo}` : null,
              line.withdrawRequestedAt ? `Đã gửi yêu cầu rút: ${line.withdrawRequestReason ?? ''}` : null,
              line.transfers.length > 0 ? `Phiếu điều chuyển ${line.transfers.map((t) => t.transferNo).join(', ')}` : null,
            ]
              .filter(Boolean)
              .join('. ');
            const inTransit = line.transfers.find((t) => t.status === 'IN_TRANSIT');
            const canOpenTransit = inTransit ? request.transfers.find((t) => t.id === inTransit.id)?.canOpen === true : false;
            const canWithdrawLine = canWithdraw && !line.withdrawRequestedAt && (withdrawOnlyWaiting ? line.fulfilStatus === 'WAITING_STOCK' : line.fulfilStatus === 'PENDING' || line.fulfilStatus === 'WAITING_STOCK');
            return (
              <div key={line.id} role="row" style={{ gridTemplateColumns: REQUESTER_GRID, minHeight: 56 }} className="grid items-center gap-x-4 border-b border-slate-100 px-4 py-2 text-sm">
                <div role="cell" className="min-w-0">
                  <p className="truncate font-semibold text-slate-900">{line.drugName}</p>
                  {line.lineNote && <p className="truncate text-xs text-slate-500">{line.lineNote}</p>}
                </div>
                <div role="cell" className="text-center font-semibold tabular-nums text-slate-900">{line.requestedQty}</div>
                <div role="cell" className="text-center font-medium tabular-nums text-slate-900">{line.allocatedQty}</div>
                <div role="cell" className="text-center font-medium tabular-nums text-slate-900">{line.fulfilStatus === 'REJECTED' || line.fulfilStatus === 'WITHDRAWN' ? line.requestedQty : line.remainingQty}</div>
                <div role="cell" className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <StatusBadge tone={meta.tone}>{meta.label}</StatusBadge>
                    {line.withdrawRequestedAt && <StatusBadge tone="warning">Chờ kho cấp xác nhận rút</StatusBadge>}
                    {inTransit && canOpenTransit && request.canActAsRequester && (
                      <Button type="button" variant="info" className="px-2.5 py-1 text-xs" onClick={() => navigate(`/inventory/transfers/${inTransit.id}`)}>
                        Kiểm nhận
                      </Button>
                    )}
                    {canWithdrawLine && (
                      <Button type="button" variant="dangerGhost" className="px-2.5 py-1 text-xs" onClick={() => onWithdraw([line.id])}>
                        Rút dòng
                      </Button>
                    )}
                  </div>
                  {sub && <p className="mt-0.5 text-xs text-slate-500">{sub}</p>}
                </div>
              </div>
            );
          })}
          </div>
        </div>
      </div>
    </div>
  );
}

/** "Xin phần thiếu lên cấp trên": chọn các dòng còn thiếu, tạo phiếu con tới kho cấp trên (chi nhánh chính). */
function EscalateDialog({ request, onClose }: { request: StockRequestDetail; onClose: () => void }) {
  const navigate = useNavigate();
  const mutation = useEscalateStockRequestMutation();
  const candidates = request.lines.filter((l) => (l.fulfilStatus === 'PENDING' || l.fulfilStatus === 'WAITING_STOCK') && l.remainingQty > 0 && l.waitChildRequestId === null);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(candidates.filter((l) => (l.supplierStock ?? 0) < l.remainingQty).map((l) => l.id)));
  const [error, setError] = useState<string | null>(null);

  function toggle(lineId: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(lineId)) next.delete(lineId);
      else next.add(lineId);
      return next;
    });
  }

  async function submit() {
    if (picked.size === 0) {
      setError('Chọn ít nhất 1 dòng.');
      return;
    }
    setError(null);
    try {
      const result = await mutation.mutateAsync({ id: request.id, body: { version: request.version, lineIds: [...picked] } });
      onClose();
      navigate(`/inventory/requests/${result.child.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Xin phần thiếu thất bại, vui lòng thử lại.');
    }
  }

  return (
    <ConfirmDialog
      icon={ArrowUUpLeft}
      size="md"
      title="Xin phần thiếu lên cấp trên"
      rows={[{ label: 'Phiếu', value: request.requestNo }]}
      note="Tạo phiếu mới xin đúng phần còn thiếu; dòng gốc chuyển sang Chờ hàng về."
      error={error}
      onClose={onClose}
      actions={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Đóng
          </Button>
          <Button type="button" loading={mutation.isPending} onClick={() => void submit()}>
            Gửi yêu cầu
          </Button>
        </>
      }
    >
      <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
        {candidates.map((l) => (
          <li key={l.id}>
            <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm">
              <input type="checkbox" checked={picked.has(l.id)} onChange={() => toggle(l.id)} className="h-4 w-4" />
              <span className="min-w-0 flex-1 truncate font-semibold text-slate-900">{l.drugName}</span>
              <span className="text-slate-500">
                thiếu {l.remainingQty} {l.unitCode}
              </span>
            </label>
          </li>
        ))}
      </ul>
    </ConfirmDialog>
  );
}

/** Kho cấp xử lý "Yêu cầu rút" của bên xin (#298 giai đoạn 2): dòng chờ hàng về đã gắn đơn NCC đã đặt. Xác nhận thì dòng rút; giữ lại thì dòng vẫn chờ hàng về. Đơn NCC không bị huỷ theo. */
function WithdrawRequestNotice({ request, onError }: { request: StockRequestDetail; onError: (message: string | null) => void }) {
  const mutation = useResolveWithdrawRequestsMutation();
  const lines = request.lines.filter((l) => l.withdrawRequestedAt);
  async function resolve(action: 'CONFIRM' | 'DECLINE') {
    onError(null);
    try {
      await mutation.mutateAsync({ id: request.id, body: { version: request.version, lineIds: lines.map((l) => l.id), action } });
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'Xử lý yêu cầu rút thất bại, vui lòng thử lại.');
    }
  }
  return (
    <div role="status" className="flex flex-shrink-0 flex-wrap items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
      <span>
        <strong>Bên xin gửi yêu cầu rút:</strong> {lines.map((l) => `${l.drugName} (đơn ${l.waitPurchaseOrderNo ?? '—'}, lý do: ${l.withdrawRequestReason ?? '—'})`).join('; ')}. Đơn đặt hàng không bị huỷ; hàng về vẫn nhập kho của bạn.
      </span>
      <span className="flex gap-2">
        <Button type="button" variant="secondary" loading={mutation.isPending} onClick={() => void resolve('DECLINE')}>
          Giữ lại
        </Button>
        <Button type="button" variant="amber" loading={mutation.isPending} onClick={() => void resolve('CONFIRM')}>
          Xác nhận rút
        </Button>
      </span>
    </div>
  );
}
