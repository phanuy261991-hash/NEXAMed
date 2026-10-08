import { useEffect } from 'react';
import { ClipboardText } from '@phosphor-icons/react';
import type { ParaclinicalQueueRow } from '@nexamed/shared';
import { Button } from '../../shared/ui/Button';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { StatusBadge } from '../../shared/ui/StatusBadge';
import { formatDateTimeVn } from '../../shared/format/time';
import { formatWaitDuration, genderShort, SERVICE_KIND_LABELS } from './paraclinical-result-labels';
import { PARACLINICAL_GROUP_META, type ParaclinicalGroup } from './paraclinical-group';

/**
 * Hộp thoại xem nhanh chi tiết phiếu (nút mắt "Xem chi tiết phiếu" ở dòng hàng đợi — mockup 12a/12b). Chỉ dựa trên dữ liệu dòng đã tải (không gọi API): bệnh nhân, mã phiếu, các dịch vụ trong dòng,
 * mẫu/nhóm hoặc phòng thực hiện, trạng thái (tab), tình trạng thu tiền, mốc chờ. Dùng được ở MỌI tab, kể cả phiếu chưa lấy mẫu/chưa thu tiền (chưa mở được màn nhập kết quả). Đóng bằng X, "Đóng" hoặc Esc.
 */
export function ParaclinicalOrderQuickViewDialog({ row, group, onClose }: { row: ParaclinicalQueueRow; group: ParaclinicalGroup; onClose: () => void }) {
  const meta = PARACLINICAL_GROUP_META[group];

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const fields: { label: string; value: string }[] = [
    { label: 'Bệnh nhân', value: row.patientName },
    { label: 'Mã bệnh nhân', value: row.patientCode },
    { label: 'Tuổi · Giới tính', value: `${row.ageYears ?? '—'} · ${genderShort(row.gender)}` },
    { label: 'Loại dịch vụ', value: SERVICE_KIND_LABELS[row.serviceKind] },
    group === 'lab'
      ? { label: 'Mẫu bệnh phẩm', value: row.specimenNames.length > 0 ? row.specimenNames.join(', ') : '—' }
      : { label: 'Phòng thực hiện', value: row.departmentName ?? '—' },
    ...(group === 'lab' && row.categoryNames.length > 0 ? [{ label: 'Nhóm xét nghiệm', value: row.categoryNames.join(', ') }] : []),
    { label: row.bucket === 'COMPLETED' ? 'Có kết quả lúc' : 'Mốc tính thời gian chờ', value: `${formatDateTimeVn(row.waitingSince)}${row.bucket === 'COMPLETED' ? '' : ` (${formatWaitDuration(row.waitingSince)})`}` },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4" role="dialog" aria-modal="true" aria-label="Chi tiết phiếu cận lâm sàng">
      <div className="flex max-h-[92vh] w-full max-w-xl flex-col rounded-lg bg-white p-5 shadow-xl">
        <ModalHeader icon={ClipboardText} title="Chi tiết phiếu" subtitle={`Số: ${row.orderNo}`} onClose={onClose} />
        <div className="scroll-hover min-h-0 flex-1 space-y-4 overflow-y-auto">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone="info">{meta.bucketLabels[row.bucket]}</StatusBadge>
            {row.paid ? <StatusBadge tone="success">Đã thu</StatusBadge> : <StatusBadge tone="warning">{row.bucket === 'AWAITING_PAYMENT' ? 'Chưa thu' : 'Nợ phí'}</StatusBadge>}
            {row.isAmendment && <StatusBadge tone="accent">Đính chính</StatusBadge>}
          </div>

          <dl className="grid grid-cols-1 gap-x-4 gap-y-2.5 sm:grid-cols-2">
            {fields.map((f) => (
              <div key={f.label} className="min-w-0">
                <dt className="text-sm font-medium text-slate-500">{f.label}</dt>
                <dd className="break-words text-base font-semibold text-slate-900">{f.value}</dd>
              </div>
            ))}
          </dl>

          <section aria-label="Dịch vụ trong phiếu" className="overflow-hidden rounded-lg border border-slate-200">
            <div className="border-b-2 border-blue-600 bg-slate-100 px-3 py-2 text-xs font-bold uppercase tracking-wide text-slate-800">Dịch vụ chỉ định ({row.serviceNames.length})</div>
            <ol className="divide-y divide-slate-100">
              {row.serviceNames.map((name, index) => (
                <li key={`${index}-${name}`} className="flex gap-3 px-3 py-2 text-sm">
                  <span className="w-5 flex-none text-center font-medium text-slate-500">{index + 1}</span>
                  <span className="min-w-0 font-medium text-slate-900">{name}</span>
                </li>
              ))}
            </ol>
          </section>
        </div>
        <div className="mt-4 flex justify-end">
          <Button type="button" variant="secondary" onClick={onClose}>
            Đóng
          </Button>
        </div>
      </div>
    </div>
  );
}
