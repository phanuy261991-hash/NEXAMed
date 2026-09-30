import { useMemo, useState } from 'react';
import { ArrowCounterClockwise } from '@phosphor-icons/react';
import type { Invoice } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { SelectionCheckbox } from '../../shared/ui/SelectionCheckbox';
import { Textarea } from '../../shared/ui/Textarea';
import { formatVnd } from '../../shared/format/currency';
import { useRefundInvoiceItemsMutation } from './invoice.queries';

/**
 * round-half-up của `net × k / total` bằng BigInt — CHỈ để xem trước tổng tiền hoàn trong dialog này
 * (server tự tính lại thật ở `computeLineRefundAmount()`, `@nexamed/core`). Web KHÔNG import
 * `@nexamed/core` (chỉ dùng ở `apps/api`/`packages/core`), nên lặp lại công thức nhỏ này tại đây
 * thay vì kéo phụ thuộc — đúng khuôn đã chốt ở #032/#091 (hàm thuần không đặt trong `packages/shared`
 * vì Rollup lỗi named-export hàm).
 */
function roundedShare(net: bigint, k: bigint, total: bigint): bigint {
  if (total === 0n) return 0n;
  return (2n * net * k + total) / (2n * total);
}
function previewLineRefundAmount(lineNet: number, lineQty: number, alreadyRefundedQty: number, refundQty: number): number {
  const net = BigInt(lineNet);
  const total = BigInt(lineQty);
  const after = roundedShare(net, BigInt(alreadyRefundedQty + refundQty), total);
  const before = roundedShare(net, BigInt(alreadyRefundedQty), total);
  return Number(after - before);
}

type RefundableLine = Invoice['lines'][number];

/**
 * "Hoàn tiền thuốc" (#203) — hoàn MỘT PHẦN theo từng dòng thuốc đã chọn số lượng, khác dialog
 * "Hoàn tiền" (#085, hoàn TOÀN PHẦN khi lượt khám đã huỷ) ở `InvoiceDetailPage.tsx`. Chỉ liệt kê
 * dòng `lineSource==='DRUG'` còn số lượng hoàn được (`quantity - refundedQuantity > 0`).
 *
 * Bố cục dạng BẢNG (.claude/docs/ui-guidelines.md mục 4.2 — đường kẻ giữa các hàng, không xếp thẻ lồng
 * thẻ) + dải tổng cuối: tổng hoàn và nơi tiền quay về (ví trước, phần dư ra tiền mặt/CK).
 * "Nhập lại kho" MẶC ĐỊNH BẬT — bỏ tick nghĩa là thuốc coi như hỏng/mất: vẫn hoàn tiền nhưng tồn kho giữ nguyên.
 */
export function RefundDrugItemsDialog({ invoice, onClose }: { invoice: Invoice; onClose: () => void }) {
  const refundableLines = useMemo(() => invoice.lines.filter((l) => l.lineSource === 'DRUG' && l.quantity - l.refundedQuantity > 0), [invoice.lines]);

  const [selected, setSelected] = useState<Record<string, { quantity: number; restock: boolean }>>({});
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const mutation = useRefundInvoiceItemsMutation(invoice.encounterId);

  const defaultSelection = (line: RefundableLine) => ({ quantity: line.quantity - line.refundedQuantity, restock: true });

  function toggleLine(line: RefundableLine) {
    setSelected((prev) => {
      const next = { ...prev };
      if (next[line.id]) {
        delete next[line.id];
      } else {
        next[line.id] = defaultSelection(line);
      }
      return next;
    });
  }

  const allSelected = refundableLines.length > 0 && refundableLines.every((l) => selected[l.id]);
  const someSelected = refundableLines.some((l) => selected[l.id]);
  function toggleAll() {
    setSelected(allSelected ? {} : Object.fromEntries(refundableLines.map((l) => [l.id, selected[l.id] ?? defaultSelection(l)])));
  }

  function updateLine(lineId: string, patch: Partial<{ quantity: number; restock: boolean }>) {
    setSelected((prev) => (prev[lineId] ? { ...prev, [lineId]: { ...prev[lineId], ...patch } } : prev));
  }

  const previewTotal = refundableLines.reduce((sum, line) => {
    const sel = selected[line.id];
    if (!sel || sel.quantity <= 0) return sum;
    return sum + previewLineRefundAmount(line.netAmount, line.quantity, line.refundedQuantity, sel.quantity);
  }, 0);

  // Xem trước nơi tiền quay về — server chia ví trước (`allocateRefundAcrossPayments`), phần ví còn hoàn
  // được = số đã trả bằng ví − mọi khoản đã hoàn trước đó (các lần trước cũng đi ví trước).
  const walletPaid = invoice.payments.filter((p) => p.method === 'WALLET').reduce((sum, p) => sum + p.amount, 0);
  const walletPart = Math.min(previewTotal, Math.max(0, walletPaid - invoice.refundedAmount));
  const otherPart = previewTotal - walletPart;

  const selectedCount = Object.keys(selected).length;
  const isValid = selectedCount > 0 && reason.trim() !== '' && Object.values(selected).every((s) => s.quantity > 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isValid) return;
    setError(null);
    try {
      await mutation.mutateAsync({
        invoiceId: invoice.id,
        reason: reason.trim(),
        version: invoice.version,
        lines: Object.entries(selected).map(([invoiceLineId, s]) => ({ invoiceLineId, quantity: s.quantity, restock: s.restock })),
      });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Có lỗi xảy ra, vui lòng thử lại.');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-labelledby="refund-drug-title">
      <div className="w-full max-w-3xl rounded-lg bg-white p-5 shadow-xl">
        <form onSubmit={(e) => void handleSubmit(e)}>
          <ModalHeader icon={ArrowCounterClockwise} title="Hoàn tiền thuốc" subtitle={`Phiếu ${invoice.invoiceNo}`} onClose={onClose} />

          {refundableLines.length === 0 ? (
            <p className="text-sm text-slate-600">Không còn dòng thuốc nào hoàn được.</p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <table className="w-full border-collapse text-sm">
                <thead>
                  <tr className="border-b-2 border-blue-600 bg-slate-100 text-xs font-bold uppercase tracking-wide text-slate-800">
                    <th className="w-10 py-2.5 pl-3 text-left">
                      <SelectionCheckbox checked={allSelected} indeterminate={!allSelected && someSelected} onChange={toggleAll} ariaLabel="Chọn tất cả dòng thuốc" />
                    </th>
                    <th className="px-2 py-2.5 text-left">Thuốc</th>
                    <th className="w-32 px-2 py-2.5 text-center">Số lượng hoàn</th>
                    <th className="w-32 whitespace-nowrap px-2 py-2.5 text-center">Nhập lại kho</th>
                    <th className="w-28 py-2.5 pl-2 pr-3 text-right">Tiền hoàn</th>
                  </tr>
                </thead>
                <tbody>
                  {refundableLines.map((line) => {
                    const remaining = line.quantity - line.refundedQuantity;
                    const sel = selected[line.id];
                    return (
                      <tr key={line.id} className={`border-b border-slate-100 last:border-0 ${sel ? 'bg-blue-50/50' : ''}`}>
                        <td className="py-3 pl-3">
                          <SelectionCheckbox checked={!!sel} onChange={() => toggleLine(line)} ariaLabel={`Chọn hoàn ${line.examTypeName}`} />
                        </td>
                        <td className="px-2 py-3">
                          <div className="font-semibold text-slate-900">{line.examTypeName}</div>
                          <div className="text-xs text-slate-500">
                            Đã bán {line.quantity}
                            {line.refundedQuantity > 0 && <> · đã hoàn {line.refundedQuantity}</>}
                          </div>
                        </td>
                        <td className="px-2 py-3 text-center">
                          {sel ? (
                            <span className="inline-flex items-center gap-1.5">
                              <input
                                type="number"
                                min={1}
                                max={remaining}
                                value={sel.quantity}
                                aria-label={`Số lượng hoàn ${line.examTypeName}`}
                                onChange={(e) => {
                                  const raw = Number(e.target.value);
                                  const clamped = Number.isFinite(raw) ? Math.min(Math.max(raw, 1), remaining) : 1;
                                  updateLine(line.id, { quantity: clamped });
                                }}
                                className="w-16 rounded-md border border-slate-300 px-2 py-1 text-right text-sm font-semibold tabular-nums text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                              />
                              <span className="text-xs tabular-nums text-slate-500">/ {remaining}</span>
                            </span>
                          ) : (
                            <span className="text-xs tabular-nums text-slate-400">tối đa {remaining}</span>
                          )}
                        </td>
                        <td className="px-2 py-3 text-center">
                          {sel ? (
                            <span className="inline-flex justify-center">
                              <SelectionCheckbox checked={sel.restock} onChange={() => updateLine(line.id, { restock: !sel.restock })} ariaLabel={`Nhập lại kho ${line.examTypeName}`} />
                            </span>
                          ) : (
                            <span className="text-slate-300">—</span>
                          )}
                        </td>
                        <td className="py-3 pl-2 pr-3 text-right font-semibold tabular-nums text-slate-900">
                          {sel ? formatVnd(previewLineRefundAmount(line.netAmount, line.quantity, line.refundedQuantity, sel.quantity)) : <span className="text-slate-300">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {/* Dải tổng — thay khung tím có icon tròn cũ: số liệu thuần, đúng mật độ bảng dữ liệu. */}
              <div className="flex items-end justify-between gap-4 border-t border-slate-200 bg-slate-50 px-3 py-3">
                <div className="text-sm leading-relaxed text-slate-600">
                  {previewTotal > 0 ? (
                    <>
                      <div>
                        Về ví tạm ứng: <span className="font-semibold tabular-nums text-slate-900">{formatVnd(walletPart)}</span>
                      </div>
                      <div>
                        Tiền mặt/CK theo phương thức đã thu: <span className="font-semibold tabular-nums text-slate-900">{formatVnd(otherPart)}</span>
                      </div>
                    </>
                  ) : (
                    <div>Chọn dòng thuốc khách trả lại.</div>
                  )}
                </div>
                <div className="text-right">
                  <div className="text-[11px] font-bold uppercase tracking-wide text-slate-500">Tổng hoàn</div>
                  <div className="text-2xl font-bold tabular-nums text-violet-700">{formatVnd(previewTotal)}</div>
                </div>
              </div>
            </div>
          )}

          <p className="mt-2 text-[13px] text-slate-500">Bỏ tick "Nhập lại kho" nếu thuốc hỏng/không dùng lại được — vẫn hoàn tiền nhưng tồn kho giữ nguyên.</p>

          <div className="mt-3.5">
            <Textarea id="refund-drug-reason" label="Lý do" required rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ví dụ: khách trả lại thuốc còn nguyên" />
          </div>

          {error && (
            <p role="alert" className="mt-3 text-sm font-semibold text-rose-600">
              {error}
            </p>
          )}

          <div className="mt-4 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose}>
              Đóng
            </Button>
            <Button type="submit" variant="danger" disabled={!isValid} loading={mutation.isPending}>
              Xác nhận hoàn tiền
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
