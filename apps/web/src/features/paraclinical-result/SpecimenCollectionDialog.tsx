import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { ArrowCounterClockwise, Barcode, CheckCircle, Printer, TestTube, Warning } from '@phosphor-icons/react';
import type { SpecimenCollectionState, SpecimenCollectVia, SpecimenTubeView } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { formatClockTime } from '../../shared/format/time';
import { Button } from '../../shared/ui/Button';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { genderShort } from './paraclinical-result-labels';
import { CapColorDot } from '../../shared/ui/SpecimenCapColor';
import { SpecimenLabelSheet, type SpecimenLabelData } from './SpecimenLabelSheet';
import { normalizeScan } from './specimen-scan';
import { useSpecimenCollection } from './specimen-tube.queries';

/** Lý do chọn nhanh khi "Huỷ ống & lấy lại" — thẻ chọn hiện sẵn (ui-guidelines mục 12), "Khác" thì phải gõ ghi chú. */
const RECOLLECT_REASONS = ['Mẫu đông', 'Vỡ / đổ ống', 'Không đủ thể tích', 'Tan máu', 'Dán nhầm tem', 'Khác'] as const;

function labelOf(state: SpecimenCollectionState, tube: SpecimenTubeView): SpecimenLabelData {
  return {
    sid: tube.sid,
    patientName: state.patientName,
    patientCode: state.patientCode,
    patientBirthYear: state.patientBirthYear,
    patientAgeYears: state.patientAgeYears,
    patientGender: state.patientGender,
    groupAbbreviation: tube.groupAbbreviation,
    capLabel: tube.capLabel,
  };
}

const errorMessage = (err: unknown, fallback: string): string => (err instanceof ApiError ? err.message : fallback);

/**
 * Hộp thoại "Lấy mẫu xét nghiệm" (Lấy mẫu xét nghiệm có tem mã vạch, docs/DECISIONS.md #220; mockup 13b/13c). Mở ra là SINH ỐNG (kèm mã ống SID) cho các xét nghiệm của phiếu, gộp theo
 * loại mẫu bệnh phẩm. KTV: đối chiếu họ tên/năm sinh với người bệnh → in tem dán ống (tuỳ chọn) → tích "Đã lấy" từng ống (tay hoặc quét tem vào ô "Quét mã ống") → "Xác nhận".
 * Ống chưa tích ở lại "Chờ lấy mẫu". Sự cố: in lại tem, huỷ ống & lấy lại (SID mới), tách 1 xét nghiệm sang ống riêng (trước khi in tem). Quét nhầm tem của bệnh nhân khác bị chặn.
 */
export function SpecimenCollectionDialog({ orderId, initialSid, onClose }: { orderId: string; initialSid?: string | null; onClose: () => void }) {
  const api = useSpecimenCollection();
  const [state, setState] = useState<SpecimenCollectionState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [scanText, setScanText] = useState('');
  const [scanError, setScanError] = useState<string | null>(null);
  const [scanNote, setScanNote] = useState<string | null>(null);
  /** Ống đã tích trong hộp thoại nhưng CHƯA xác nhận: mã ống → cách tích (quét/tay). */
  const [ticked, setTicked] = useState<Map<string, SpecimenCollectVia>>(new Map());
  const [recollectId, setRecollectId] = useState<string | null>(null);
  const [recollectReason, setRecollectReason] = useState<string>(RECOLLECT_REASONS[0]);
  const [recollectNote, setRecollectNote] = useState('');
  const [printSet, setPrintSet] = useState<SpecimenLabelData[]>([]);
  const scanRef = useRef<HTMLInputElement>(null);
  const initialSidHandled = useRef(false);
  // Chỉ gọi 1 lần lúc mở: sinh ống là thao tác ghi (idempotent) — StrictMode gọi effect 2 lần cũng không đẻ thêm ống.
  const opened = useRef(false);

  useEffect(() => {
    if (opened.current) return;
    opened.current = true;
    // `mutateAsync` + promise (không dùng callback của `mutate`): callback theo lần gọi bị bỏ nếu component được gắn/gỡ lại (React StrictMode ở dev chạy effect 2 lần).
    api.open
      .mutateAsync(orderId)
      .then(setState)
      .catch((err: unknown) => setLoadError(errorMessage(err, 'Không mở được hộp thoại lấy mẫu. Thử lại sau.')));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ chạy một lần khi mở
  }, [orderId]);

  useEffect(() => {
    function onKeyDown(e: globalThis.KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const tubes = useMemo(() => state?.tubes ?? [], [state]);
  const activeTubes = tubes.filter((t) => t.status !== 'CANCELLED');
  const collectedCount = activeTubes.filter((t) => t.status === 'COLLECTED').length;
  const pendingTubes = activeTubes.filter((t) => t.status === 'PENDING');
  const tickedCount = pendingTubes.filter((t) => ticked.has(t.id)).length;
  const notTickedCount = pendingTubes.length - tickedCount;
  const hasActionsColumn = tubes.some((t) => t.status === 'COLLECTED' || t.printCount > 0 || t.status === 'CANCELLED');
  const scanRequired = state?.scanRequired ?? false;

  function tick(tubeId: string, via: SpecimenCollectVia) {
    setTicked((prev) => new Map(prev).set(tubeId, via));
  }
  function untick(tubeId: string) {
    setTicked((prev) => {
      const next = new Map(prev);
      next.delete(tubeId);
      return next;
    });
  }

  /** Xử lý một mã quét/gõ: tích ống nếu đúng ống của phiếu; ngược lại báo lỗi tại chỗ (kèm tên người bệnh nếu là tem của người khác). */
  async function handleScan(raw: string, currentState: SpecimenCollectionState | null = state) {
    const sid = normalizeScan(raw);
    setScanText('');
    if (sid === '' || !currentState) return;
    setScanError(null);
    setScanNote(null);
    const found = currentState.tubes.find((t) => t.sid === sid);
    if (found) {
      if (found.status === 'COLLECTED') setScanNote(`Ống ${sid} đã được xác nhận lấy mẫu rồi.`);
      else if (found.status === 'CANCELLED') setScanError(`Ống ${sid} đã huỷ${found.replacedBySid ? ` — dùng ống thay thế ${found.replacedBySid}` : ''}.`);
      else tick(found.id, 'SCAN');
      return;
    }
    try {
      const other = await api.lookup.mutateAsync(sid);
      setScanError(`Ống ${sid} là của ${other.patientName.toLocaleUpperCase('vi-VN')} (${other.patientCode}) — không phải người bệnh đang lấy mẫu. Kiểm tra lại tem trên ống.`);
    } catch (err) {
      setScanError(err instanceof ApiError && err.code === 'NOT_FOUND' ? `Không tìm thấy ống mang mã ${sid}.` : errorMessage(err, 'Không tra được mã ống. Thử lại sau.'));
    }
  }

  // Mở từ ô quét ở hàng đợi: ống vừa quét được tích sẵn.
  useEffect(() => {
    if (state && initialSid && !initialSidHandled.current) {
      initialSidHandled.current = true;
      void handleScan(initialSid, state);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- chỉ xử lý mã ban đầu một lần khi nạp xong
  }, [state, initialSid]);

  function onScanKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter') return;
    e.preventDefault(); // không để Enter trong ô quét gửi cả form "Xác nhận"
    void handleScan(scanText).finally(() => scanRef.current?.focus());
  }

  async function handlePrint(toPrint: SpecimenTubeView[], currentState: SpecimenCollectionState | null = state) {
    if (!currentState || toPrint.length === 0) return;
    setActionError(null);
    try {
      setPrintSet(toPrint.map((t) => labelOf(currentState, t)));
      const next = await api.print.mutateAsync({ tubeIds: toPrint.map((t) => t.id) });
      setState(next);
      // Chờ React vẽ xong bản in rồi mới mở hộp thoại in của trình duyệt (đúng khuôn các màn in khác).
      setTimeout(() => window.print(), 100);
    } catch (err) {
      setActionError(errorMessage(err, 'Không ghi nhận được lần in tem. Thử lại sau.'));
    }
  }

  async function handleSplit(tubeId: string, itemId: string) {
    setActionError(null);
    try {
      setState(await api.split.mutateAsync({ tubeId, itemId }));
    } catch (err) {
      setActionError(errorMessage(err, 'Không tách được xét nghiệm sang ống riêng.'));
    }
  }

  async function handleConfirmRecollect(tube: SpecimenTubeView) {
    const reason = recollectReason === 'Khác' ? recollectNote.trim() : recollectNote.trim() ? `${recollectReason} — ${recollectNote.trim()}` : recollectReason;
    if (reason === '') {
      setActionError('Chọn lý do hoặc nhập ghi chú khi huỷ ống.');
      return;
    }
    setActionError(null);
    try {
      const next = await api.recollect.mutateAsync({ tubeId: tube.id, reason });
      setState(next);
      untick(tube.id);
      setRecollectId(null);
      setRecollectNote('');
      // "Huỷ ống & in tem mới": in luôn tem của ống thay thế.
      const replacement = next.tubes.find((t) => t.replacesSid === tube.sid && t.status !== 'CANCELLED');
      if (replacement) await handlePrint([replacement], next);
    } catch (err) {
      setActionError(errorMessage(err, 'Không huỷ được ống. Thử lại sau.'));
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!state || tickedCount === 0) return;
    setActionError(null);
    try {
      const body = { tubes: pendingTubes.filter((t) => ticked.has(t.id)).map((t) => ({ tubeId: t.id, via: ticked.get(t.id)! })) };
      const next = await api.collect.mutateAsync(body);
      setState(next);
      setTicked(new Map());
      // Lấy đủ mọi ống → đóng hộp thoại, KTV gọi người kế tiếp; còn ống chưa lấy → giữ mở để lấy tiếp.
      if (next.tubes.filter((t) => t.status !== 'CANCELLED').every((t) => t.status === 'COLLECTED')) onClose();
    } catch (err) {
      setActionError(errorMessage(err, 'Không xác nhận được lấy mẫu. Thử lại sau.'));
    }
  }

  const printable = activeTubes;
  const gridCols = hasActionsColumn ? 'grid-cols-[72px_40px_150px_160px_minmax(0,1fr)_126px_104px_88px]' : 'grid-cols-[72px_40px_150px_160px_minmax(0,1fr)_126px_104px]';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4" role="dialog" aria-modal="true" aria-label="Lấy mẫu xét nghiệm">
      <form onSubmit={handleSubmit} className="flex max-h-[94vh] w-full max-w-[1140px] flex-col rounded-lg bg-white p-5 shadow-xl">
        <ModalHeader
          icon={TestTube}
          title="Lấy mẫu xét nghiệm"
          subtitle={state ? `Phiếu ${state.orderNo}` : undefined}
          right={state ? <StatusBadge tone={state.paid ? 'success' : 'warning'}>{state.paid ? 'Đã thu tiền' : 'Chưa thu tiền'}</StatusBadge> : undefined}
          onClose={onClose}
        />

        <div className="scroll-hover min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
          {loadError && <ErrorBanner message={loadError} />}
          {!state && !loadError && (
            <div className="space-y-2" aria-busy="true">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          )}

          {state && (
            <>
              {/* Định danh người bệnh — đọc để đối chiếu miệng (read-back) với người bệnh. */}
              <div className="grid grid-cols-1 gap-4 rounded-lg border border-slate-200 px-4 py-3 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1fr)]">
                <div className="min-w-0">
                  <div className="text-sm font-medium text-slate-500">Họ và tên người bệnh</div>
                  <div className="truncate text-xl font-bold text-slate-900" title={state.patientName}>
                    {state.patientName.toLocaleUpperCase('vi-VN')}
                  </div>
                  <div className="text-sm font-semibold text-slate-800">
                    {genderShort(state.patientGender)} · Sinh năm {state.patientBirthYear ?? '—'}
                    {state.patientAgeYears !== null ? ` (${state.patientAgeYears} tuổi)` : ''}
                  </div>
                </div>
                <div>
                  <div className="text-sm font-medium text-slate-500">Mã bệnh nhân · Điện thoại</div>
                  <div className="text-base font-semibold text-slate-900">{state.patientCode}</div>
                  <div className="text-sm font-medium text-slate-700">{state.patientPhone ?? '—'}</div>
                </div>
                <div>
                  <div className="text-sm font-medium text-slate-500">Bác sĩ chỉ định</div>
                  <div className="text-base font-semibold text-slate-900">{state.doctorName ?? '—'}</div>
                  <div className="text-sm font-medium text-slate-700">
                    {state.encounterNo ?? '—'} · {formatClockTime(state.orderedAt)}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] font-semibold text-amber-800">
                <Warning size={16} weight="fill" className="flex-none" aria-hidden="true" />
                Hỏi lại họ tên và năm sinh của người bệnh, khớp với tem trước khi lấy mẫu.
              </div>

              {/* Ô quét: súng quét USB gõ mã + Enter. */}
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative w-full max-w-[520px] flex-1">
                  <label htmlFor="sc-scan" className="sr-only">
                    Quét mã ống
                  </label>
                  <Barcode size={18} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-blue-600" aria-hidden="true" />
                  <input
                    id="sc-scan"
                    ref={scanRef}
                    autoFocus
                    value={scanText}
                    onChange={(e) => setScanText(e.target.value)}
                    onKeyDown={onScanKeyDown}
                    autoComplete="off"
                    placeholder="Quét tem ống (hoặc gõ mã ống rồi Enter) để đánh dấu đã lấy"
                    className="w-full rounded-md border-2 border-blue-500 py-2 pl-10 pr-3 text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-500/25"
                  />
                </div>
                {!scanRequired && (
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={pendingTubes.length === 0 || notTickedCount === 0}
                    onClick={() => setTicked(new Map(pendingTubes.map((t) => [t.id, 'MANUAL' as const])))}
                  >
                    Đánh dấu tất cả
                  </Button>
                )}
                <div className="ml-auto text-sm font-bold text-slate-900">
                  Đã lấy <span className="text-blue-600">{collectedCount + tickedCount}</span>/{activeTubes.length} ống
                </div>
              </div>
              {scanRequired && <p className="text-[13px] font-medium text-slate-500">Phòng khám đang bắt buộc quét tem: ô "Đã lấy" chỉ tích được bằng cách quét mã trên tem.</p>}
              {scanError && (
                <div role="alert" className="flex items-center gap-2 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-[13px] font-semibold text-rose-700">
                  <Warning size={16} weight="fill" className="flex-none" aria-hidden="true" />
                  {scanError}
                </div>
              )}
              {scanNote && !scanError && <p className="text-[13px] font-semibold text-slate-600">{scanNote}</p>}
              {actionError && <ErrorBanner message={actionError} />}

              {/* Bảng ống — gộp tự động theo loại mẫu bệnh phẩm. */}
              <div>
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <div className="text-sm font-bold text-slate-900">
                    Ống cần lấy <span className="font-semibold text-slate-500">({activeTubes.length})</span>
                  </div>
                  <div className="text-[13px] text-slate-500">
                    Tự gộp xét nghiệm cùng loại mẫu vào 1 ống · bấm <strong className="text-slate-700">Tách</strong> để đưa 1 xét nghiệm sang ống riêng (trước khi in tem)
                  </div>
                </div>
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <div role="table" aria-label="Các ống mẫu cần lấy" style={{ minWidth: hasActionsColumn ? 980 : 880 }}>
                    <div role="row" className={`grid ${gridCols} border-b-2 border-blue-600 bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-800`}>
                      <div role="columnheader" className="px-2 py-2.5 text-center">
                        Đã lấy
                      </div>
                      <div role="columnheader" className="px-1 py-2.5 text-center">
                        STT
                      </div>
                      <div role="columnheader" className="px-2 py-2.5">
                        Ống / màu nắp
                      </div>
                      <div role="columnheader" className="px-2 py-2.5">
                        Loại mẫu
                      </div>
                      <div role="columnheader" className="px-2 py-2.5">
                        Xét nghiệm trong ống
                      </div>
                      <div role="columnheader" className="px-2 py-2.5 text-center">
                        Mã ống (SID)
                      </div>
                      <div role="columnheader" className="px-2 py-2.5 text-center">
                        Tem
                      </div>
                      {hasActionsColumn && (
                        <div role="columnheader" className="px-2 py-2.5 text-center">
                          Thao tác
                        </div>
                      )}
                    </div>

                    {tubes.map((tube) => {
                      const cancelled = tube.status === 'CANCELLED';
                      const collected = tube.status === 'COLLECTED';
                      const isTicked = collected || ticked.has(tube.id);
                      const stt = cancelled ? '—' : String(activeTubes.indexOf(tube) + 1);
                      const via = collected ? tube.collectedVia : ticked.get(tube.id);
                      return (
                        <div key={tube.id} role="rowgroup">
                          <div role="row" className={`grid ${gridCols} items-center border-b border-slate-100 text-sm ${cancelled ? 'bg-slate-50 text-slate-400' : isTicked ? 'bg-blue-50' : ''} ${recollectId === tube.id ? 'bg-rose-50' : ''}`} style={{ minHeight: 58 }}>
                            <div className="flex flex-col items-center gap-0.5 px-2">
                              {!cancelled && (
                                <>
                                  <input
                                    type="checkbox"
                                    checked={isTicked}
                                    disabled={collected || scanRequired}
                                    onChange={(e) => (e.target.checked ? tick(tube.id, 'MANUAL') : untick(tube.id))}
                                    aria-label={`Đã lấy ống ${tube.sid}`}
                                    className="h-[18px] w-[18px] accent-blue-600"
                                  />
                                  <span className="text-[10.5px] font-semibold text-blue-600">{via === 'SCAN' ? 'đã quét' : ''}</span>
                                </>
                              )}
                            </div>
                            <div className="px-1 text-center font-semibold text-slate-600">{stt}</div>
                            <div className="flex items-center gap-2 px-2">
                              <span className={cancelled ? 'opacity-40' : ''}>
                                <CapColorDot color={tube.capColor} size={18} />
                              </span>
                              <span className="font-semibold">{tube.capLabel ?? 'Chưa khai màu'}</span>
                            </div>
                            <div className="px-2 font-medium">{tube.specimenName ?? 'Chưa khai loại mẫu'}</div>
                            <div className="flex flex-wrap items-center gap-1.5 px-2 py-1.5">
                              {cancelled ? (
                                <span className="font-medium">
                                  {tube.cancelledAt ? `Huỷ lúc ${formatClockTime(tube.cancelledAt)}` : 'Đã huỷ'} · Lý do: {tube.cancelReason ?? '—'}
                                </span>
                              ) : (
                                <>
                                  {tube.items.map((item) => (
                                    <span key={item.itemId} className="inline-flex items-center gap-1.5 rounded-md border border-slate-300 bg-white py-0.5 pl-2 pr-1 text-[13px] font-medium text-slate-900">
                                      {item.name}
                                      {item.canSplit && (
                                        <button
                                          type="button"
                                          onClick={() => void handleSplit(tube.id, item.itemId)}
                                          aria-label={`Tách ${item.name} sang ống riêng`}
                                          className="rounded bg-blue-50 px-1.5 text-[11.5px] font-semibold text-blue-700 hover:bg-blue-100"
                                        >
                                          Tách
                                        </button>
                                      )}
                                    </span>
                                  ))}
                                  {tube.replacesSid && <StatusBadge tone="warning">Lấy lại · thay {tube.replacesSid}</StatusBadge>}
                                </>
                              )}
                            </div>
                            <div className={`px-2 text-center font-bold tabular-nums ${cancelled ? 'line-through' : 'text-slate-900'}`}>{tube.sid}</div>
                            <div className="px-2 text-center">
                              {cancelled ? <StatusBadge tone="neutral">Đã huỷ</StatusBadge> : tube.printCount > 0 ? <StatusBadge tone="success">{`Đã in · ${tube.printCount} lần`}</StatusBadge> : <StatusBadge tone="neutral">Chưa in</StatusBadge>}
                            </div>
                            {hasActionsColumn && (
                              <div className="flex items-center justify-center gap-1.5 px-2">
                                {!cancelled && (
                                  <>
                                    <Button type="button" variant="secondary" className="px-2" aria-label={`In lại tem ống ${tube.sid}`} title="In lại tem (giữ nguyên mã ống)" onClick={() => void handlePrint([tube])}>
                                      <Printer size={15} weight="regular" aria-hidden="true" />
                                    </Button>
                                    {tube.canRecollect && (
                                      <Button
                                        type="button"
                                        variant={recollectId === tube.id ? 'danger' : 'dangerGhost'}
                                        className="px-2"
                                        aria-label={`Huỷ ống ${tube.sid} và lấy lại mẫu`}
                                        title="Huỷ ống & lấy lại mẫu (mã ống mới)"
                                        onClick={() => setRecollectId(recollectId === tube.id ? null : tube.id)}
                                      >
                                        <ArrowCounterClockwise size={15} weight="bold" aria-hidden="true" />
                                      </Button>
                                    )}
                                  </>
                                )}
                              </div>
                            )}
                          </div>

                          {recollectId === tube.id && (
                            <div className="border-b border-dashed border-rose-300 bg-rose-50 px-4 py-3 sm:pl-16">
                              <div className="mb-2 text-sm font-bold text-rose-800">Huỷ ống {tube.sid} và lấy lại mẫu — ống mới sẽ có mã mới, ống cũ giữ lại ở trạng thái “Đã huỷ”</div>
                              <div className="mb-1.5 text-sm font-semibold text-slate-800">
                                Lý do <span className="text-rose-600">*</span>
                              </div>
                              <div className="mb-2 flex flex-wrap gap-2" role="group" aria-label="Lý do huỷ ống">
                                {RECOLLECT_REASONS.map((reason) => {
                                  const selected = recollectReason === reason;
                                  return (
                                    <button
                                      key={reason}
                                      type="button"
                                      aria-pressed={selected}
                                      onClick={() => setRecollectReason(reason)}
                                      className={`rounded-md border px-3 py-1.5 text-[13px] font-semibold ${selected ? 'border-brand-teal bg-brand-teal text-white' : 'border-slate-300 bg-white text-slate-700 hover:border-blue-400 hover:bg-brand-teal-tint'}`}
                                    >
                                      {reason}
                                    </button>
                                  );
                                })}
                              </div>
                              <div className="flex flex-wrap items-center gap-2">
                                <label htmlFor="sc-recollect-note" className="sr-only">
                                  Ghi chú thêm
                                </label>
                                <input
                                  id="sc-recollect-note"
                                  value={recollectNote}
                                  onChange={(e) => setRecollectNote(e.target.value)}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      void handleConfirmRecollect(tube);
                                    }
                                  }}
                                  placeholder={recollectReason === 'Khác' ? 'Nhập lý do (bắt buộc)' : 'Ghi chú thêm (không bắt buộc)'}
                                  className="min-w-0 flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                                />
                                <Button type="button" variant="secondary" onClick={() => setRecollectId(null)}>
                                  Thôi
                                </Button>
                                <Button type="button" variant="danger" loading={api.recollect.isPending} onClick={() => void handleConfirmRecollect(tube)}>
                                  Huỷ ống &amp; in tem mới
                                </Button>
                              </div>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-slate-200 px-4 py-2.5">
                  <div className="text-sm font-medium text-slate-500">Người lấy mẫu</div>
                  <div className="text-base font-semibold text-slate-900">Tài khoản đang đăng nhập</div>
                </div>
                <div className="rounded-lg border border-slate-200 px-4 py-2.5">
                  <div className="text-sm font-medium text-slate-500">Thời gian lấy mẫu</div>
                  <div className="text-base font-semibold text-slate-900">
                    {collectedCount > 0 ? `Đã ghi cho ${collectedCount} ống · ` : ''}Tự ghi cho từng ống lúc bấm xác nhận
                  </div>
                </div>
              </div>
            </>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 pt-3">
          {state && notTickedCount > 0 && pendingTubes.length > 0 ? (
            <p className="text-[13px] font-semibold text-amber-700">
              Còn {notTickedCount} ống chưa lấy — sẽ ở lại tab “Chờ lấy mẫu”.
            </p>
          ) : (
            <p className="text-[13px] text-slate-500">In tem là tuỳ chọn — phòng khám chưa có máy in tem vẫn bấm xác nhận được.</p>
          )}
          <div className="flex flex-wrap items-center gap-2.5">
            <Button type="button" variant="secondary" onClick={onClose}>
              Đóng
            </Button>
            <Button type="button" variant="info" disabled={!state || printable.length === 0} loading={api.print.isPending} onClick={() => void handlePrint(printable)}>
              <Printer size={15} weight="bold" aria-hidden="true" />
              In tem ({printable.length})
            </Button>
            <Button type="submit" disabled={!state || tickedCount === 0} loading={api.collect.isPending}>
              <CheckCircle size={15} weight="bold" aria-hidden="true" />
              {tickedCount > 0 ? `Xác nhận ${tickedCount} ống đã lấy` : 'Xác nhận đã lấy mẫu'}
            </Button>
          </div>
        </div>
      </form>
      <SpecimenLabelSheet labels={printSet} />
    </div>
  );
}
