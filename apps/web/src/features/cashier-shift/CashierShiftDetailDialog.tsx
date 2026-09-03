import { useState } from 'react';
import { ArrowsClockwise, CheckCircle, LockSimple, X } from '@phosphor-icons/react';
import type { CashierShiftDiscrepancyResolution } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { formatVnd } from '../../shared/format/currency';
import { Button } from '../../shared/ui/Button';
import { MoneyInput } from '../../shared/ui/MoneyInput';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { Skeleton } from '../../shared/ui/Skeleton';
import { useAuthStore } from '../auth/auth.store';
import { useClinicPrintHeaderQuery } from '../clinic/clinic.queries';
import { CashierShiftReceiptView } from './CashierShiftReceiptView';
import {
  useApproveCashierShiftMutation,
  useCashierShiftDetailQuery,
  useCashierShiftResyncPreviewMutation,
  useEditCashierShiftMutation,
  useResolveCashierShiftDiscrepancyMutation,
} from './cashier-shift.queries';

/** Đúng ma trận mặc định `cashier_shift.manage` (`packages/core/src/rbac/permissions.ts`) — chỉ clinic_admin. */
const MANAGE_ROLES = ['clinic_admin'];

const RESOLUTION_LABEL: Record<CashierShiftDiscrepancyResolution, string> = {
  DEDUCT: 'Trừ vào lương / bắt thu ngân đền phần thiếu',
  INCOME: 'Ghi nhận thu nhập khác (trường hợp dư tiền)',
  WAIVE: 'Bỏ qua — chấp nhận sai số nhỏ',
};

export function CashierShiftDetailDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const currentUser = useAuthStore((s) => s.user);
  const canManage = currentUser?.roles.some((role) => MANAGE_ROLES.includes(role)) ?? false;

  const [showReceipt, setShowReceipt] = useState(false);
  const [editing, setEditing] = useState(false);
  const [resolutionMethod, setResolutionMethod] = useState<CashierShiftDiscrepancyResolution>('DEDUCT');
  const [resolutionNote, setResolutionNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const detailQuery = useCashierShiftDetailQuery(id);
  const clinicHeaderQuery = useClinicPrintHeaderQuery();
  const resolveMutation = useResolveCashierShiftDiscrepancyMutation(id);
  const approveMutation = useApproveCashierShiftMutation(id);

  const shift = detailQuery.data;
  const diff = shift ? (shift.countedCashAmount ?? 0) - (shift.expectedCashAmount ?? 0) : 0;

  async function handleResolve() {
    if (!shift) return;
    setError(null);
    try {
      await resolveMutation.mutateAsync({ method: resolutionMethod, note: resolutionNote.trim() === '' ? undefined : resolutionNote, version: shift.version });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không lưu được, vui lòng thử lại.');
    }
  }

  async function handleApprove() {
    if (!shift) return;
    setError(null);
    try {
      await approveMutation.mutateAsync({ version: shift.version });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không duyệt được, vui lòng thử lại.');
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-labelledby="cashier-shift-detail-title">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-xl">
        <div className="flex flex-shrink-0 items-start justify-between border-b border-slate-100 px-6 pt-6 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <h2 id="cashier-shift-detail-title" className="text-lg font-bold text-slate-900">
                {shift ? `Phiếu chốt ca — ${shift.shiftNo}` : 'Phiếu chốt ca'}
              </h2>
              {shift?.editedAt && <StatusBadge tone="info">Đã chỉnh sửa</StatusBadge>}
            </div>
            {shift && (
              <p className="mt-1 text-sm font-medium text-slate-500">
                {shift.shiftLabel} · {shift.cashierName} · {new Date(shift.openedAt).toLocaleString('vi-VN')} – {shift.closedAt ? new Date(shift.closedAt).toLocaleString('vi-VN') : '—'}
                {shift.editedAt && ` · Sửa lần cuối bởi ${shift.editedByName} lúc ${new Date(shift.editedAt).toLocaleString('vi-VN')}`}
              </p>
            )}
          </div>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700" aria-label="Đóng">
            <X size={20} weight="bold" aria-hidden="true" />
          </button>
        </div>

        <div className="scroll-hover flex-1 overflow-y-auto px-6 py-5">
          {detailQuery.isPending && <Skeleton className="h-64 w-full" />}
          {detailQuery.isError && <p className="text-sm font-medium text-rose-600">Không tải được chi tiết phiếu chốt ca.</p>}

          {shift && !showReceipt && (
            <div className="space-y-4">
              <div className={`flex items-start gap-2.5 rounded-lg border px-4 py-3 ${shift.status === 'APPROVED' ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
                <LockSimple size={18} weight="regular" className={`mt-0.5 flex-shrink-0 ${shift.status === 'APPROVED' ? 'text-emerald-600' : 'text-amber-600'}`} aria-hidden="true" />
                <p className={`flex-1 text-sm font-semibold ${shift.status === 'APPROVED' ? 'text-emerald-700' : 'text-amber-800'}`}>
                  {shift.status === 'APPROVED'
                    ? canManage
                      ? 'Phiếu đã chốt và ĐÃ DUYỆT — vẫn có thể mở khoá tạm thời để sửa nếu cần.'
                      : 'Phiếu đã chốt và đã được Quản lý duyệt.'
                    : canManage
                      ? 'Phiếu đã chốt — chờ Quản lý kiểm tra & duyệt.'
                      : 'Phiếu đã chốt — dữ liệu bị khoá. Liên hệ Quản lý để mở khoá sửa.'}
                </p>
              </div>

              <div className="grid grid-cols-5 gap-2.5">
                <StatCard label="Vốn đầu ca" value={formatVnd(shift.openingFloatActual)} />
                <StatCard label="Tiền hệ thống" value={shift.expectedCashAmount !== null ? formatVnd(shift.expectedCashAmount) : '—'} />
                <StatCard label="Tiền thực tế" value={shift.countedCashAmount !== null ? formatVnd(shift.countedCashAmount) : '—'} />
                <StatCard
                  label="Chênh lệch"
                  value={diff === 0 ? 'Khớp — 0 đ' : formatVnd(diff)}
                  tone={diff === 0 ? 'emerald' : 'rose'}
                />
                <StatCard label="Đã nộp về" value={shift.submittedAmount !== null ? formatVnd(shift.submittedAmount) : '—'} />
              </div>

              {diff !== 0 && (
                <div>
                  <div className="mb-1 text-[11px] font-bold uppercase tracking-wide text-slate-400">Lý do chênh lệch (thu ngân giải trình)</div>
                  <p className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm font-medium text-slate-700">{shift.cashDiscrepancyReason || '(chưa có giải trình)'}</p>
                </div>
              )}

              {diff !== 0 && canManage && (
                <div className="rounded-lg border border-slate-200 p-4">
                  <div className="mb-2.5 text-[11px] font-bold uppercase tracking-wide text-slate-400">Xử lý chênh lệch (Quản lý)</div>
                  {shift.resolutionMethod ? (
                    <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3.5 py-3">
                      <p className="text-sm font-semibold text-emerald-700">
                        ✓ Đã xử lý: {RESOLUTION_LABEL[shift.resolutionMethod]}
                        {shift.resolutionNote ? ` — ${shift.resolutionNote}` : ''}
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="space-y-2">
                        {(Object.keys(RESOLUTION_LABEL) as CashierShiftDiscrepancyResolution[]).map((method) => (
                          <label key={method} className="flex items-center gap-2 text-sm font-medium text-slate-700">
                            <input type="radio" name="resolution-method" checked={resolutionMethod === method} onChange={() => setResolutionMethod(method)} className="text-blue-600" />
                            {RESOLUTION_LABEL[method]}
                          </label>
                        ))}
                      </div>
                      <textarea
                        rows={2}
                        value={resolutionNote}
                        onChange={(e) => setResolutionNote(e.target.value)}
                        placeholder="Ghi chú xử lý (tuỳ chọn)..."
                        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                      />
                      <Button type="button" variant="amber" onClick={() => void handleResolve()} loading={resolveMutation.isPending}>
                        Lưu cách xử lý
                      </Button>
                    </div>
                  )}
                </div>
              )}

              {editing && canManage && <EditShiftPanel shiftId={shift.id} onDone={() => setEditing(false)} />}

              {error && <p className="text-sm font-medium text-rose-600">{error}</p>}
            </div>
          )}

          {shift && showReceipt && clinicHeaderQuery.data && <CashierShiftReceiptView shift={shift} clinicHeader={clinicHeaderQuery.data} />}
        </div>

        {shift && (
          <div className="flex flex-shrink-0 items-center justify-end gap-2 border-t border-slate-100 px-6 py-4">
            <Button type="button" variant="secondary" onClick={() => setShowReceipt((v) => !v)}>
              {showReceipt ? 'Xem chi tiết' : 'In lại phiếu'}
            </Button>
            {canManage && !editing && !showReceipt && (
              <Button type="button" variant="amber" onClick={() => setEditing(true)}>
                Mở khoá để sửa
              </Button>
            )}
            {canManage && !showReceipt && shift.status === 'CLOSED' && (
              <Button type="button" onClick={() => void handleApprove()} loading={approveMutation.isPending} className="inline-flex items-center gap-1.5">
                <CheckCircle size={16} weight="bold" aria-hidden="true" />
                Đã kiểm tra / Duyệt phiếu
              </Button>
            )}
            {canManage && !showReceipt && shift.status === 'APPROVED' && (
              <span className="inline-flex items-center gap-1.5 rounded-md bg-emerald-100 px-4 py-2 text-sm font-semibold text-emerald-700">
                <CheckCircle size={16} weight="bold" aria-hidden="true" />
                Đã duyệt
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: string; tone?: 'emerald' | 'rose' }) {
  const border = tone === 'emerald' ? 'border-emerald-200 bg-emerald-50' : tone === 'rose' ? 'border-rose-200 bg-rose-50' : 'border-slate-200';
  const labelColor = tone === 'emerald' ? 'text-emerald-600' : tone === 'rose' ? 'text-rose-500' : 'text-slate-400';
  const valueColor = tone === 'emerald' ? 'text-emerald-700' : tone === 'rose' ? 'text-rose-700' : 'text-slate-900';
  return (
    <div className={`rounded-lg border p-3 ${border}`}>
      <div className={`text-[10px] font-bold uppercase tracking-wide ${labelColor}`}>{label}</div>
      <div className={`mt-1 text-sm font-bold ${valueColor}`}>{value}</div>
    </div>
  );
}

/**
 * "Mở khoá để sửa" — sửa số liệu người nhập (đếm/vốn để lại/lý do/ghi chú) + "Tính toán lại" số hệ
 * thống (đọc-only preview trước, chỉ ghi đè khi bấm "Lưu thay đổi"). Bắt buộc lý do sửa, ghi audit
 * before/after ở backend — xem `CashierShiftService.edit()`.
 */
function EditShiftPanel({ shiftId, onDone }: { shiftId: string; onDone: () => void }) {
  const detailQuery = useCashierShiftDetailQuery(shiftId);
  const shift = detailQuery.data;
  const editMutation = useEditCashierShiftMutation(shiftId);
  const resyncMutation = useCashierShiftResyncPreviewMutation();

  const [reason, setReason] = useState('');
  const [countedAmount, setCountedAmount] = useState(shift?.countedCashAmount ?? 0);
  const [keepAmount, setKeepAmount] = useState(shift?.keepForNextAmount ?? 0);
  const [discrepancyReason, setDiscrepancyReason] = useState(shift?.cashDiscrepancyReason ?? '');
  const [handoverNote, setHandoverNote] = useState(shift?.handoverNote ?? '');
  const [resynced, setResynced] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!shift) return null;

  async function handleSave() {
    setError(null);
    if (!reason.trim()) return;
    try {
      await editMutation.mutateAsync({
        reason,
        version: shift!.version,
        countedCashAmount: countedAmount,
        keepForNextAmount: keepAmount,
        cashDiscrepancyReason: discrepancyReason.trim() === '' ? undefined : discrepancyReason,
        handoverNote: handoverNote.trim() === '' ? undefined : handoverNote,
        resyncSystemTotals: resynced,
      });
      onDone();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không lưu được, vui lòng thử lại.');
    }
  }

  return (
    <div className="rounded-lg border-2 border-amber-300 bg-amber-50/40 p-4">
      <div className="mb-3 text-[11px] font-bold uppercase tracking-wide text-amber-700">Sửa phiếu đã chốt (Quản lý)</div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-sm font-semibold text-slate-800">Tiền mặt thực tế đếm được</label>
          <MoneyInput id="edit-counted" value={countedAmount} onChange={(v) => setCountedAmount(v ?? 0)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-900" />
        </div>
        <div>
          <label className="mb-1 block text-sm font-semibold text-slate-800">Tiền lẻ để lại ca sau</label>
          <MoneyInput id="edit-keep" value={keepAmount} onChange={(v) => setKeepAmount(v ?? 0)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-semibold text-slate-900" />
        </div>
      </div>

      <div className="mt-3">
        <label className="mb-1 block text-sm font-semibold text-slate-800">Lý do chênh lệch</label>
        <textarea rows={2} value={discrepancyReason} onChange={(e) => setDiscrepancyReason(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-900" />
      </div>
      <div className="mt-3">
        <label className="mb-1 block text-sm font-semibold text-slate-800">Ghi chú bàn giao</label>
        <textarea rows={2} value={handoverNote} onChange={(e) => setHandoverNote(e.target.value)} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm font-medium text-slate-900" />
      </div>

      <div className="mt-3 flex items-center gap-2">
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            void resyncMutation.mutateAsync(shiftId).then(() => setResynced(true));
          }}
          loading={resyncMutation.isPending}
          className="inline-flex items-center gap-1.5"
        >
          <ArrowsClockwise size={15} weight="regular" aria-hidden="true" />
          Tính toán lại
        </Button>
        {resyncMutation.data && (
          <span className="text-xs font-semibold text-slate-600">
            Số hệ thống mới: Tiền mặt dự kiến {formatVnd(resyncMutation.data.expectedCashAmount)} — sẽ áp dụng khi lưu.
          </span>
        )}
      </div>

      <div className="mt-4">
        <label className="mb-1 block text-sm font-semibold text-slate-800">
          Lý do sửa <span className="text-rose-500">*</span>
        </label>
        <textarea
          rows={2}
          required
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Ví dụ: Sửa do thu ngân gõ thiếu số 0."
          className="w-full rounded-md border border-rose-300 bg-white px-3 py-2 text-sm font-semibold text-slate-900"
        />
      </div>

      {error && <p className="mt-2 text-sm font-medium text-rose-600">{error}</p>}

      <div className="mt-3 flex justify-end gap-2">
        <Button type="button" variant="secondary" onClick={onDone}>
          Huỷ
        </Button>
        <Button type="button" variant="amber" onClick={() => void handleSave()} loading={editMutation.isPending} disabled={!reason.trim()}>
          Lưu thay đổi
        </Button>
      </div>
    </div>
  );
}
