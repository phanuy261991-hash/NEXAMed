import { useState } from 'react';
import { ArrowUUpLeft, Prohibit, TrendUp } from '@phosphor-icons/react';
import type { Icon } from '@phosphor-icons/react';
import type { SupplierDebtAdjustment, SupplierDebtAdjustmentKind } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { StatusBadge, type StatusBadgeTone } from '../../shared/ui/StatusBadge';
import { formatVnd } from '../../shared/format/currency';
import { useHasPermission } from '../auth/usePermission';
import { useApproveSupplierDebtAdjustmentMutation, useRejectSupplierDebtAdjustmentMutation } from './supplier-debt.queries';

const KIND_META: Record<SupplierDebtAdjustmentKind, { label: string; icon: Icon }> = {
  INCREASE: { label: 'Điều chỉnh tăng nợ', icon: TrendUp },
  DECREASE: { label: 'Điều chỉnh giảm nợ', icon: ArrowUUpLeft },
  VOID_REQUEST: { label: 'Đề nghị huỷ chứng từ', icon: Prohibit },
};

const STATUS_META: Record<SupplierDebtAdjustment['status'], { label: string; tone: StatusBadgeTone }> = {
  PENDING_APPROVAL: { label: 'Chờ duyệt', tone: 'warning' },
  APPROVED: { label: 'Đã duyệt', tone: 'success' },
  REJECTED: { label: 'Đã từ chối', tone: 'danger' },
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const vn = new Date(d.getTime() + 7 * 60 * 60_000);
  return `${String(vn.getUTCHours()).padStart(2, '0')}:${String(vn.getUTCMinutes()).padStart(2, '0')} · ${String(vn.getUTCDate()).padStart(2, '0')}/${String(vn.getUTCMonth() + 1).padStart(2, '0')}/${vn.getUTCFullYear()}`;
}

/**
 * Chi tiết 1 Phiếu điều chỉnh công nợ/Đề nghị huỷ (Phần D, docs/DECISIONS.md #180/#182/#187) — xem +
 * Duyệt/Từ chối khi `PENDING_APPROVAL` và actor có `supplier_debt.approve` (KHÔNG cần quyền duyệt
 * phiếu nhập/xuất gốc — đã xác nhận đúng ở backend). Nhận nguyên `adjustment` (không tự query theo
 * id — không có endpoint `GET .../adjustments/:id`, nơi gọi tự tìm lại từ danh sách đã tải, tự động
 * cập nhật theo cache sau khi Duyệt/Từ chối).
 */
export function SupplierDebtAdjustmentDetailDialog({ adjustment, onClose }: { adjustment: SupplierDebtAdjustment; onClose: () => void }) {
  const canApprove = useHasPermission('supplier_debt', 'approve');
  const [rejecting, setRejecting] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const approveMutation = useApproveSupplierDebtAdjustmentMutation();
  const rejectMutation = useRejectSupplierDebtAdjustmentMutation();

  const kindMeta = KIND_META[adjustment.kind];
  const targetLabel = adjustment.targetReceiptId ? 'Phiếu nhập' : adjustment.targetIssueId ? 'Phiếu xuất' : adjustment.targetVoucherId ? 'Phiếu thu/chi' : null;

  async function handleApprove() {
    setError(null);
    try {
      await approveMutation.mutateAsync({ id: adjustment.id, body: { version: adjustment.version } });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Có lỗi xảy ra, vui lòng thử lại.');
    }
  }

  async function handleReject() {
    if (rejectReason.trim() === '') return;
    setError(null);
    try {
      await rejectMutation.mutateAsync({ id: adjustment.id, body: { rejectionReason: rejectReason.trim(), version: adjustment.version } });
      setRejecting(false);
      setRejectReason('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Có lỗi xảy ra, vui lòng thử lại.');
    }
  }

  return (
    <div className="fixed inset-0 z-60 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-label="Chi tiết điều chỉnh công nợ">
      <div className="w-full max-w-lg rounded-lg bg-white p-6 shadow-xl">
        <ModalHeader
          icon={kindMeta.icon}
          title={kindMeta.label}
          subtitle={adjustment.adjustmentNo}
          onClose={onClose}
          right={<StatusBadge tone={STATUS_META[adjustment.status].tone}>{STATUS_META[adjustment.status].label}</StatusBadge>}
        />

        {error && <ErrorBanner message={error} />}

        <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
          <div>
            <span className="text-slate-500">Nhà cung cấp</span>
            <p className="font-semibold text-slate-900">{adjustment.supplierName}</p>
          </div>
          {adjustment.amount !== null && (
            <div>
              <span className="text-slate-500">Số tiền</span>
              <p className="font-bold text-slate-900">{formatVnd(adjustment.amount)}</p>
            </div>
          )}
          {targetLabel && (
            <div>
              <span className="text-slate-500">Chứng từ liên quan</span>
              <p className="font-semibold text-slate-900">{targetLabel}</p>
            </div>
          )}
          <div>
            <span className="text-slate-500">Người đề nghị</span>
            <p className="font-semibold text-slate-900">{adjustment.createdByName}</p>
          </div>
          {adjustment.approvedByName && (
            <div>
              <span className="text-slate-500">{adjustment.status === 'REJECTED' ? 'Từ chối bởi' : 'Duyệt bởi'}</span>
              <p className="font-semibold text-slate-900">
                {adjustment.approvedByName}
                {adjustment.selfApproved && adjustment.status === 'APPROVED' && (
                  <span className="ml-1.5 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-bold text-blue-700">Tự duyệt</span>
                )}
              </p>
              {adjustment.approvedAt && <p className="text-xs text-slate-400">{formatDateTime(adjustment.approvedAt)}</p>}
            </div>
          )}
          <div className="col-span-2">
            <span className="text-slate-500">Lý do</span>
            <p className="font-medium text-slate-900">{adjustment.reason}</p>
          </div>
          {adjustment.evidenceRef && (
            <div className="col-span-2">
              <span className="text-slate-500">Số biên bản</span>
              <p className="font-medium text-slate-900">{adjustment.evidenceRef}</p>
            </div>
          )}
          {adjustment.rejectionReason && (
            <div className="col-span-2 text-rose-600">
              <span className="text-slate-500">Lý do từ chối:</span> {adjustment.rejectionReason}
            </div>
          )}
        </div>

        {rejecting && (
          <div className="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3">
            <label htmlFor="adj-reject-reason" className="text-sm font-semibold text-rose-800">
              Lý do từ chối <span className="text-rose-500">*</span>
            </label>
            <textarea
              id="adj-reject-reason"
              rows={2}
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="mt-1.5 w-full rounded-md border border-rose-300 px-3 py-2 text-sm focus:border-rose-500 focus:outline-none"
            />
            <div className="mt-2 flex justify-end gap-2">
              <Button type="button" variant="secondary" onClick={() => setRejecting(false)}>
                Đóng
              </Button>
              <Button type="button" variant="danger" loading={rejectMutation.isPending} disabled={rejectReason.trim() === ''} onClick={() => void handleReject()}>
                Xác nhận từ chối
              </Button>
            </div>
          </div>
        )}

        {!rejecting && canApprove && adjustment.status === 'PENDING_APPROVAL' && (
          <div className="mt-5 flex justify-end gap-2 border-t border-slate-100 pt-4">
            <Button type="button" variant="danger" onClick={() => setRejecting(true)}>
              Từ chối
            </Button>
            <Button type="button" loading={approveMutation.isPending} onClick={() => void handleApprove()}>
              Duyệt
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
