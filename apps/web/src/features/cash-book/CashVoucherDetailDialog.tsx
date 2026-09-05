import { useMemo, useState } from 'react';
import { CheckCircle, PencilSimple, Printer, Receipt, Trash, XCircle } from '@phosphor-icons/react';
import type { CashVoucherStatus } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { StatusBadge, type StatusBadgeTone } from '../../shared/ui/StatusBadge';
import { formatVnd } from '../../shared/format/currency';
import { useHasPermission } from '../auth/usePermission';
import { useClinicPrintHeaderQuery } from '../clinic/clinic.queries';
import { useReferenceCatalogQuery } from '../reference-catalog/reference-catalog.queries';
import { useCashAccountsQuery } from './cash-account.queries';
import { CashVoucherFormDialog, type CashVoucherSubmitDto } from './CashVoucherFormDialog';
import { CashVoucherPrintView } from './CashVoucherPrintView';
import {
  useApproveCashVoucherMutation,
  useCashVoucherQuery,
  usePrintCashVoucherMutation,
  useRejectCashVoucherMutation,
  useUpdateCashVoucherMutation,
  useVoidCashVoucherMutation,
} from './cash-voucher.queries';

const STATUS_META: Record<CashVoucherStatus, { label: string; tone: StatusBadgeTone }> = {
  POSTED: { label: 'Đã ghi sổ', tone: 'success' },
  PENDING_APPROVAL: { label: 'Chờ duyệt', tone: 'warning' },
  REJECTED: { label: 'Đã từ chối', tone: 'danger' },
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const vn = new Date(d.getTime() + 7 * 60 * 60_000);
  return `${String(vn.getUTCHours()).padStart(2, '0')}:${String(vn.getUTCMinutes()).padStart(2, '0')} · ${String(vn.getUTCDate()).padStart(2, '0')}/${String(vn.getUTCMonth() + 1).padStart(2, '0')}/${vn.getUTCFullYear()}`;
}

/**
 * "Chi tiết phiếu thu/chi" (Sổ quỹ & Thu chi GĐ1) — xem + Sửa/Huỷ (chỉ khi còn sửa được, backend
 * là nguồn sự thật cuối — nút hiện theo quyền `cash_voucher.update`, scope `personal` cứ thử, lỗi
 * 404/409 hiện banner thay vì tự đoán quyền sở hữu ở tầng web) + Duyệt/Từ chối (chỉ khi
 * `PENDING_APPROVAL` và có `cash_voucher.approve`) + In (khổ A5, đúng khuôn `CashierShiftReceiptView.tsx`).
 */
export function CashVoucherDetailDialog({ voucherId, onClose }: { voucherId: string; onClose: () => void }) {
  const canUpdate = useHasPermission('cash_voucher', 'update');
  const canApprove = useHasPermission('cash_voucher', 'approve');

  const [editing, setEditing] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [printing, setPrinting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const voucherQuery = useCashVoucherQuery(voucherId);
  const voucher = voucherQuery.data ?? null;
  const clinicQuery = useClinicPrintHeaderQuery();
  const incomeExpenseTypeQuery = useReferenceCatalogQuery('INCOME_EXPENSE_TYPE', true);
  const paymentMethodQuery = useReferenceCatalogQuery('PAYMENT_METHOD', true);
  const cashAccountsQuery = useCashAccountsQuery();

  const incomeExpenseTypeLabel = useMemo(
    () => incomeExpenseTypeQuery.data?.items.find((i) => i.code === voucher?.incomeExpenseTypeCode)?.name ?? voucher?.incomeExpenseTypeCode ?? '—',
    [incomeExpenseTypeQuery.data, voucher],
  );
  const paymentMethodLabel = useMemo(
    () => paymentMethodQuery.data?.items.find((i) => i.code === voucher?.paymentMethodCode)?.name ?? voucher?.paymentMethodCode ?? '—',
    [paymentMethodQuery.data, voucher],
  );
  const cashAccountName = useMemo(
    () => cashAccountsQuery.data?.items.find((a) => a.id === voucher?.cashAccountId)?.name ?? '—',
    [cashAccountsQuery.data, voucher],
  );

  const updateMutation = useUpdateCashVoucherMutation();
  const voidMutation = useVoidCashVoucherMutation();
  const approveMutation = useApproveCashVoucherMutation();
  const rejectMutation = useRejectCashVoucherMutation();
  const printMutation = usePrintCashVoucherMutation();

  async function handleUpdateSubmit(dto: CashVoucherSubmitDto) {
    if (!voucher) return;
    await updateMutation.mutateAsync({
      id: voucher.id,
      body: {
        incomeExpenseTypeCode: dto.incomeExpenseTypeCode,
        cashAccountId: dto.cashAccountId,
        paymentMethodCode: dto.paymentMethodCode,
        amount: dto.amount,
        occurredAt: dto.occurredAt,
        partnerName: dto.partnerName,
        description: dto.description,
        note: dto.note,
        version: voucher.version,
      },
    });
  }

  async function handleVoid() {
    if (!voucher || voidReason.trim() === '') return;
    setError(null);
    try {
      await voidMutation.mutateAsync({ id: voucher.id, body: { reason: voidReason.trim(), version: voucher.version } });
      setVoiding(false);
      setVoidReason('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Có lỗi xảy ra, vui lòng thử lại.');
    }
  }

  async function handleApprove() {
    if (!voucher) return;
    setError(null);
    try {
      await approveMutation.mutateAsync({ id: voucher.id, body: { version: voucher.version } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Có lỗi xảy ra, vui lòng thử lại.');
    }
  }

  async function handleReject() {
    if (!voucher || rejectReason.trim() === '') return;
    setError(null);
    try {
      await rejectMutation.mutateAsync({ id: voucher.id, body: { reason: rejectReason.trim(), version: voucher.version } });
      setRejecting(false);
      setRejectReason('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Có lỗi xảy ra, vui lòng thử lại.');
    }
  }

  async function handlePrint() {
    if (!voucher) return;
    await printMutation.mutateAsync(voucher.id);
    setPrinting(true);
    setTimeout(() => {
      window.print();
      setPrinting(false);
    }, 100);
  }

  if (editing && voucher) {
    return (
      <CashVoucherFormDialog
        mode="edit"
        voucher={voucher}
        submitting={updateMutation.isPending}
        onCancel={() => setEditing(false)}
        onSubmit={handleUpdateSubmit}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
      <div className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
        <ModalHeader
          icon={Receipt}
          title={voucher?.voucherNo ?? 'Chi tiết phiếu'}
          subtitle="Sổ quỹ & Thu chi"
          onClose={onClose}
          right={
            voucher ? (
              <>
                <StatusBadge tone={STATUS_META[voucher.status].tone}>{STATUS_META[voucher.status].label}</StatusBadge>
                {voucher.voided && <StatusBadge tone="neutral">Đã huỷ</StatusBadge>}
              </>
            ) : undefined
          }
        />

        {voucherQuery.isLoading && <p className="text-sm text-slate-500">Đang tải...</p>}
        {error && <ErrorBanner message={error} onRetry={() => setError(null)} />}

        {voucher && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-x-5 gap-y-2.5 text-sm text-slate-700">
              <div>
                <span className="text-slate-400">Chiều tiền:</span>{' '}
                <span className="font-semibold text-slate-900">{voucher.direction === 'INCOME' ? 'Phiếu thu' : 'Phiếu chi'}</span>
              </div>
              <div>
                <span className="text-slate-400">Ngày phát sinh:</span>{' '}
                <span className="font-semibold text-slate-900">{formatDateTime(voucher.occurredAt)}</span>
              </div>
              <div>
                <span className="text-slate-400">Loại thu chi:</span> <span className="font-semibold text-slate-900">{incomeExpenseTypeLabel}</span>
              </div>
              <div>
                <span className="text-slate-400">Hình thức:</span> <span className="font-semibold text-slate-900">{paymentMethodLabel}</span>
              </div>
              <div>
                <span className="text-slate-400">Quỹ:</span> <span className="font-semibold text-slate-900">{cashAccountName}</span>
              </div>
              <div>
                <span className="text-slate-400">{voucher.direction === 'INCOME' ? 'Người nộp:' : 'Người nhận:'}</span>{' '}
                <span className="font-semibold text-slate-900">{voucher.partnerName ?? '—'}</span>
              </div>
              <div className="col-span-2">
                <span className="text-slate-400">Diễn giải:</span> <span className="font-semibold text-slate-900">{voucher.description}</span>
              </div>
              {voucher.note && (
                <div className="col-span-2">
                  <span className="text-slate-400">Ghi chú:</span> <span className="text-slate-700">{voucher.note}</span>
                </div>
              )}
              <div className="col-span-2">
                <span className="text-slate-400">Người lập:</span> <span className="font-semibold text-slate-900">{voucher.createdByName}</span>
              </div>
              {voucher.approvedByName && (
                <div className="col-span-2">
                  <span className="text-slate-400">{voucher.status === 'REJECTED' ? 'Từ chối bởi:' : 'Duyệt bởi:'}</span>{' '}
                  <span className="font-semibold text-slate-900">{voucher.approvedByName}</span>
                </div>
              )}
              {voucher.rejectionReason && (
                <div className="col-span-2 text-rose-600">
                  <span className="text-slate-400">Lý do từ chối:</span> {voucher.rejectionReason}
                </div>
              )}
            </div>

            <div
              className={`flex items-center justify-between rounded-lg px-4 py-3 ${voucher.direction === 'INCOME' ? 'bg-emerald-50' : 'bg-rose-50'}`}
            >
              <span className="font-bold text-slate-900">Số tiền</span>
              <span className={`text-lg font-bold ${voucher.direction === 'INCOME' ? 'text-emerald-700' : 'text-rose-700'}`}>
                {formatVnd(voucher.amount)}
              </span>
            </div>

            {voiding && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
                <label htmlFor="cv-void-reason" className="text-sm font-semibold text-rose-800">
                  Lý do huỷ phiếu <span className="text-rose-500">*</span>
                </label>
                <textarea
                  id="cv-void-reason"
                  rows={2}
                  value={voidReason}
                  onChange={(e) => setVoidReason(e.target.value)}
                  className="mt-1.5 w-full rounded-md border border-rose-300 px-3 py-2 text-sm focus:border-rose-500 focus:outline-none"
                />
                <div className="mt-2 flex justify-end gap-2">
                  <Button type="button" variant="secondary" onClick={() => setVoiding(false)}>
                    Đóng
                  </Button>
                  <Button type="button" variant="danger" loading={voidMutation.isPending} disabled={voidReason.trim() === ''} onClick={handleVoid}>
                    Xác nhận huỷ
                  </Button>
                </div>
              </div>
            )}

            {rejecting && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
                <label htmlFor="cv-reject-reason" className="text-sm font-semibold text-rose-800">
                  Lý do từ chối <span className="text-rose-500">*</span>
                </label>
                <textarea
                  id="cv-reject-reason"
                  rows={2}
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  className="mt-1.5 w-full rounded-md border border-rose-300 px-3 py-2 text-sm focus:border-rose-500 focus:outline-none"
                />
                <div className="mt-2 flex justify-end gap-2">
                  <Button type="button" variant="secondary" onClick={() => setRejecting(false)}>
                    Đóng
                  </Button>
                  <Button type="button" variant="danger" loading={rejectMutation.isPending} disabled={rejectReason.trim() === ''} onClick={handleReject}>
                    Xác nhận từ chối
                  </Button>
                </div>
              </div>
            )}

            {printing && clinicQuery.data && (
              <CashVoucherPrintView
                voucher={voucher}
                clinicHeader={clinicQuery.data}
                incomeExpenseTypeLabel={incomeExpenseTypeLabel}
                cashAccountName={cashAccountName}
                paymentMethodLabel={paymentMethodLabel}
              />
            )}

            <div className="flex flex-wrap justify-end gap-2 border-t border-slate-100 pt-4">
              <Button type="button" variant="secondary" onClick={handlePrint} loading={printMutation.isPending}>
                <Printer size={15} weight="bold" aria-hidden="true" />
                In phiếu
              </Button>
              {canUpdate && !voucher.voided && voucher.status !== 'REJECTED' && (
                <>
                  <Button type="button" variant="secondary" onClick={() => setEditing(true)}>
                    <PencilSimple size={15} weight="bold" aria-hidden="true" />
                    Sửa
                  </Button>
                  <Button type="button" variant="danger" onClick={() => setVoiding(true)}>
                    <Trash size={15} weight="bold" aria-hidden="true" />
                    Huỷ phiếu
                  </Button>
                </>
              )}
              {canApprove && !voucher.voided && voucher.status === 'PENDING_APPROVAL' && (
                <>
                  <Button type="button" variant="danger" onClick={() => setRejecting(true)}>
                    <XCircle size={15} weight="bold" aria-hidden="true" />
                    Từ chối
                  </Button>
                  <Button type="button" onClick={handleApprove} loading={approveMutation.isPending}>
                    <CheckCircle size={15} weight="bold" aria-hidden="true" />
                    Duyệt
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
