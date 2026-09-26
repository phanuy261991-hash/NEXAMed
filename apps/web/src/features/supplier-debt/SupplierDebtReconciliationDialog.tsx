import { useState } from 'react';
import { Scales } from '@phosphor-icons/react';
import { ApiError } from '../../shared/api/client';
import { Button } from '../../shared/ui/Button';
import { BoxedSection } from '../../shared/ui/BoxedSection';
import { DateInput } from '../../shared/ui/DateInput';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { MoneyInput } from '../../shared/ui/MoneyInput';
import { formatVnd } from '../../shared/format/currency';
import { useCreateSupplierDebtReconciliationMutation, usePreviewSupplierDebtReconciliationQuery } from './supplier-debt.queries';

function todayDateString(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/**
 * "Lập biên bản đối chiếu" — Phần E "Đối chiếu & chốt công nợ theo kỳ" (docs/DECISIONS.md #182 câu
 * 3, kế hoạch `playful-baking-kazoo.md`). Gộp 1 bước (chốt qua AskUserQuestion): nhập ngày đối chiếu
 * + số NCC xác nhận → xem trước chênh lệch ngay (không ghi gì) → bấm nút chính:
 * - Khớp (`differenceAmount === 0`): server tự CHỐT NGAY trong CÙNG lệnh gọi — đóng dialog luôn.
 * - Lệch: server tự tạo Phiếu điều chỉnh Chờ duyệt, biên bản giữ Nháp — dialog GIỮ MỞ, hiện hướng
 *   dẫn đi duyệt phiếu điều chỉnh rồi quay lại tab "Đối chiếu & Chốt kỳ" bấm "Chốt" riêng (không có
 *   hạ tầng toast trong dự án nên dùng banner tại chỗ thay vì đóng dialog im lặng).
 */
export function SupplierDebtReconciliationDialog({ supplierId, supplierName, onClose }: { supplierId: string; supplierName: string; onClose: () => void }) {
  const [asOfDate, setAsOfDate] = useState(todayDateString());
  const [confirmedBalance, setConfirmedBalance] = useState<number | undefined>(undefined);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [createdDraftNo, setCreatedDraftNo] = useState<string | null>(null);

  const previewQuery = usePreviewSupplierDebtReconciliationQuery(supplierId, asOfDate, confirmedBalance);
  const createMutation = useCreateSupplierDebtReconciliationMutation(supplierId);

  const preview = previewQuery.data;
  const isInvalid = !asOfDate || confirmedBalance === undefined || !preview;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (isInvalid || confirmedBalance === undefined) return;
    setError(null);
    try {
      const result = await createMutation.mutateAsync({ asOfDate, confirmedBalance, note: note.trim() || undefined });
      if (result.status === 'FINALIZED') {
        onClose();
      } else {
        setCreatedDraftNo(result.reconciliationNo);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Có lỗi xảy ra, vui lòng thử lại.');
    }
  }

  if (createdDraftNo) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
        <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
          <ModalHeader icon={Scales} title="Đã lập biên bản đối chiếu" subtitle={supplierName} onClose={onClose} />
          <div className="mt-3 rounded-md border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-900">
            Biên bản <strong>{createdDraftNo}</strong> đã ghi nhận chênh lệch và tự sinh 1 Phiếu điều chỉnh đang <strong>Chờ duyệt</strong>. Vào tab
            "Nhật ký điều chỉnh" để Duyệt phiếu đó, rồi quay lại tab "Đối chiếu & Chốt kỳ" bấm "Chốt" cho đúng biên bản này.
          </div>
          <div className="mt-4 flex justify-end">
            <Button type="button" onClick={onClose}>
              Đã hiểu
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
      <form className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-lg bg-white shadow-xl" onSubmit={handleSubmit}>
        <div className="flex-shrink-0 px-6 pt-6">
          <ModalHeader icon={Scales} title="Lập biên bản đối chiếu" subtitle={supplierName} onClose={onClose} />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-6">
          {error && <ErrorBanner message={error} />}
          <div className="my-4 flex flex-col gap-4">
            <BoxedSection badge="Đối chiếu">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="recon-date" className="text-sm font-semibold text-slate-800">
                    Ngày đối chiếu <span className="text-rose-500">*</span>
                  </label>
                  <DateInput id="recon-date" value={asOfDate} onChange={setAsOfDate} required />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="recon-confirmed" className="text-sm font-semibold text-slate-800">
                    Số NCC xác nhận <span className="text-rose-500">*</span>
                  </label>
                  <MoneyInput
                    id="recon-confirmed"
                    value={confirmedBalance}
                    onChange={setConfirmedBalance}
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                  <p className="text-xs text-slate-500">Số âm nếu NCC xác nhận đang nợ lại phòng khám.</p>
                </div>
                <div className="flex flex-col gap-1.5 sm:col-span-2">
                  <label htmlFor="recon-note" className="text-sm font-semibold text-slate-800">
                    Căn cứ / ghi chú
                  </label>
                  <input
                    id="recon-note"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="VD: Đối chiếu qua email ngày ..."
                    className="w-full rounded-md border border-slate-300 px-3 py-2 text-[15px] font-semibold text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
                  />
                </div>
              </div>
            </BoxedSection>

            {confirmedBalance !== undefined && previewQuery.isFetching && <p className="text-sm font-medium text-slate-500">Đang tính số hệ thống...</p>}

            {preview && (
              <div className={`rounded-md border px-4 py-3 text-sm ${preview.differenceAmount === 0 ? 'border-emerald-200 bg-emerald-50' : 'border-amber-200 bg-amber-50'}`}>
                <div className="flex justify-between gap-3">
                  <span className="font-medium text-slate-600">Số hệ thống tại {asOfDate}</span>
                  <span className="font-bold text-slate-900">{formatVnd(preview.systemBalance)}</span>
                </div>
                <div className="mt-1 flex justify-between gap-3">
                  <span className="font-medium text-slate-600">NCC xác nhận</span>
                  <span className="font-bold text-slate-900">{formatVnd(preview.confirmedBalance)}</span>
                </div>
                <div className="mt-2 flex justify-between gap-3 border-t border-slate-200 pt-2">
                  <span className="font-semibold text-slate-700">Chênh lệch</span>
                  <span className={`text-lg font-bold ${preview.differenceAmount === 0 ? 'text-emerald-700' : 'text-amber-700'}`}>
                    {preview.differenceAmount === 0 ? 'Khớp' : formatVnd(preview.differenceAmount)}
                  </span>
                </div>
                {preview.differenceAmount !== 0 && (
                  <p className="mt-2 text-xs font-medium text-amber-800">
                    Lệch → hệ thống sẽ tự tạo Phiếu điều chỉnh {preview.differenceAmount > 0 ? 'Tăng' : 'Giảm'} nợ Chờ duyệt, chưa Chốt được ngay.
                  </p>
                )}
              </div>
            )}
          </div>
        </div>
        <div className="flex flex-shrink-0 justify-end gap-2 border-t border-slate-100 bg-slate-50 px-6 py-4">
          <Button type="button" variant="secondary" onClick={onClose} disabled={createMutation.isPending}>
            Huỷ
          </Button>
          <Button type="submit" loading={createMutation.isPending} disabled={isInvalid}>
            {preview && preview.differenceAmount === 0 ? 'Chốt' : 'Lập biên bản & Tạo phiếu điều chỉnh'}
          </Button>
        </div>
      </form>
    </div>
  );
}
