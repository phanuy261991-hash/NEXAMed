import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowCircleDown, ArrowCircleUp, ClockCounterClockwise, Receipt, Stethoscope } from '@phosphor-icons/react';
import type { CashierShiftDetail } from '@nexamed/shared';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatusBadge, type StatusBadgeTone } from '../../shared/ui/StatusBadge';
import { formatVnd } from '../../shared/format/currency';
import { isoToVietnamDateString } from '../appointment/schedule-grid.utils';
import { useBillingInvoiceListQuery } from '../billing/invoice.queries';
import { CashVoucherDetailDialog } from './CashVoucherDetailDialog';
import { useCashVouchersQuery } from './cash-voucher.queries';

interface ActivityRow {
  id: string;
  timeIso: string;
  kind: 'invoice' | 'voucher';
  kindLabel: string;
  label: string;
  subLabel: string;
  amount: number;
  positive: boolean;
  statusLabel: string;
  statusTone: StatusBadgeTone;
}

const GRID_COLUMNS = '90px 170px 1.6fr 160px 140px';

function formatTime(iso: string): string {
  const d = new Date(iso);
  const vn = new Date(d.getTime() + 7 * 60 * 60_000);
  return `${String(vn.getUTCHours()).padStart(2, '0')}:${String(vn.getUTCMinutes()).padStart(2, '0')}`;
}

/**
 * "Phiếu trong ca của tôi" (yêu cầu trực tiếp 2026-09-05, chốt phương án 1 qua trao đổi, làm lại
 * bố cục cho rõ ràng/chuyên nghiệp hơn theo phản hồi trực tiếp — `ModalHeader` dùng chung mục
 * 4.1g thay vì tiêu đề tự viết tay, thêm tiêu đề cột hẳn hoi thay vì danh sách dạng "feed") — mở
 * từ nút tắt ở `InvoiceListPage.tsx`. Gộp CẢ tiền thu khám (`invoice`/`payment`) lẫn phiếu thu/chi
 * ngoài khám (`cash_voucher`) đang gắn với ca đang mở, xem LẠI thuần tuý — KHÔNG tính tổng/chênh
 * lệch gì (đã hỏi và chốt: chỉ cần danh sách, không cần con số tổng hợp).
 *
 * **Giới hạn đã biết, chấp nhận có chủ đích để giữ đơn giản (không sửa backend)**: phần tiền khám
 * dùng lại `GET /billing/invoices?date=` — endpoint này lọc theo NGÀY TIẾP NHẬN (`checkedInAt`),
 * không phải ngày thu tiền, rồi lọc lại ở client theo `paidAt` nằm trong khung giờ ca. Trường hợp
 * hiếm: bệnh nhân tiếp nhận hôm trước, thu tiền hôm sau trong ca đang xem — sẽ không thấy trong
 * danh sách này (vẫn thấy đủ trong "Danh sách cần thu" ngày tiếp nhận). Phiếu thu/chi ngoài khám
 * KHÔNG có giới hạn này (lọc thẳng theo `cashierShiftId` chính xác ở backend).
 */
export function MyShiftVouchersDialog({ shift, onClose }: { shift: CashierShiftDetail; onClose: () => void }) {
  const navigate = useNavigate();
  const [voucherDetailId, setVoucherDetailId] = useState<string | null>(null);

  const invoiceQuery = useBillingInvoiceListQuery(isoToVietnamDateString(shift.openedAt));
  const voucherQuery = useCashVouchersQuery({ cashierShiftId: shift.id });

  const openedAtMs = new Date(shift.openedAt).getTime();
  const closedAtMs = shift.closedAt ? new Date(shift.closedAt).getTime() : Date.now();

  const rows: ActivityRow[] = useMemo(() => {
    const invoiceRows: ActivityRow[] = (invoiceQuery.data?.items ?? [])
      .filter((item) => item.paidAt !== null)
      .filter((item) => {
        const t = new Date(item.paidAt!).getTime();
        return t >= openedAtMs && t < closedAtMs;
      })
      .map((item) => ({
        id: `invoice-${item.invoiceId}`,
        timeIso: item.paidAt!,
        kind: 'invoice' as const,
        kindLabel: 'Khám bệnh',
        label: item.fullName,
        subLabel: `${item.patientCode} · ${item.encounterNo}`,
        amount: item.totalAmount,
        positive: item.status !== 'REFUNDED',
        statusLabel: item.status === 'REFUNDED' ? 'Đã hoàn tiền' : 'Đã thu',
        statusTone: item.status === 'REFUNDED' ? 'accent' : 'success',
      }));

    const voucherRows: ActivityRow[] = (voucherQuery.data?.items ?? []).map((item) => ({
      id: `voucher-${item.id}`,
      timeIso: item.occurredAt,
      kind: 'voucher' as const,
      kindLabel: item.direction === 'INCOME' ? 'Thu ngoài khám' : 'Chi ngoài khám',
      label: item.description,
      subLabel: item.partnerName ?? '',
      amount: item.amount,
      positive: item.direction === 'INCOME',
      statusLabel: item.voided ? 'Đã huỷ' : item.status === 'PENDING_APPROVAL' ? 'Chờ duyệt' : item.status === 'REJECTED' ? 'Đã từ chối' : 'Đã ghi sổ',
      statusTone: item.voided ? 'neutral' : item.status === 'PENDING_APPROVAL' ? 'warning' : item.status === 'REJECTED' ? 'danger' : 'success',
    }));

    return [...invoiceRows, ...voucherRows].sort((a, b) => new Date(b.timeIso).getTime() - new Date(a.timeIso).getTime());
  }, [invoiceQuery.data, voucherQuery.data, openedAtMs, closedAtMs]);

  const isLoading = invoiceQuery.isPending || voucherQuery.isPending;

  function handleRowClick(row: ActivityRow, invoiceItem?: { encounterId: string }) {
    if (row.kind === 'invoice' && invoiceItem) {
      navigate(`/billing/${invoiceItem.encounterId}`);
      onClose();
    } else if (row.kind === 'voucher') {
      setVoucherDetailId(row.id.replace('voucher-', ''));
    }
  }

  const invoiceByRowId = new Map((invoiceQuery.data?.items ?? []).map((item) => [`invoice-${item.invoiceId}`, item]));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
      <div className="flex max-h-[85vh] w-full max-w-4xl flex-col rounded-lg bg-white p-6 shadow-xl">
        <ModalHeader
          icon={ClockCounterClockwise}
          title="Phiếu trong ca của tôi"
          subtitle={`${shift.shiftLabel} · ${shift.cashierName}`}
          onClose={onClose}
        />

        {isLoading && (
          <div className="space-y-2">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-11 w-full" />
            ))}
          </div>
        )}

        {!isLoading && rows.length === 0 && (
          <EmptyState icon={Receipt} title="Chưa có phiếu nào trong ca này" description="Phiếu thu tiền khám và phiếu thu/chi ngoài khám sẽ hiện ở đây ngay khi lập." />
        )}

        {/* `min-h-0 flex-1` cho CHÍNH div cuộn (không lồng thêm `h-full` ở div con bên trong) —
            cha chỉ có `max-h-[85vh]` (không phải `height` cố định), `h-full` (height:100%) trên
            div lồng bên trong không resolve được thành chiều cao cố định trong trường hợp này,
            khiến div tự giãn theo TOÀN BỘ nội dung thay vì bị giới hạn — bug thật phát hiện lúc
            chủ dự án tự xem: nhìn tưởng bị cắt đúng (viền ngoài `overflow-hidden` che phần thừa)
            nhưng `overflow-y-auto` bên trong không còn gì để cuộn, chuột lăn không nhúc nhích. Để
            chính flex item này vừa là flex-1 vừa là scroll container — flexbox tự tính chiều cao
            cố định cho flex item, không cần qua `height:100%`. */}
        {!isLoading && rows.length > 0 && (
          <div className="scroll-hover min-h-0 flex-1 overflow-y-auto rounded-lg border border-slate-200">
              <div style={{ minWidth: 760 }}>
                <div
                  role="row"
                  style={{ gridTemplateColumns: GRID_COLUMNS }}
                  className="sticky top-0 z-10 grid gap-x-4 border-b-2 border-blue-600 bg-slate-100 px-5 text-xs font-bold uppercase tracking-wide text-slate-800"
                >
                  <div role="columnheader" className="py-3 text-center">Giờ</div>
                  <div role="columnheader" className="py-3 text-left">Loại</div>
                  <div role="columnheader" className="py-3 text-left">Diễn giải</div>
                  <div role="columnheader" className="py-3 text-right">Số tiền</div>
                  <div role="columnheader" className="py-3 text-center">Trạng thái</div>
                </div>

                {rows.map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    role="row"
                    style={{ gridTemplateColumns: GRID_COLUMNS }}
                    onClick={() => handleRowClick(row, invoiceByRowId.get(row.id))}
                    className="grid w-full items-center gap-x-4 border-b border-slate-100 px-5 py-3 text-left last:border-0 hover:bg-slate-50"
                  >
                    <div role="cell" className="text-center text-sm font-medium text-slate-600">{formatTime(row.timeIso)}</div>
                    <div role="cell" className="flex items-center gap-1.5 text-sm font-medium text-slate-700">
                      {row.kind === 'invoice' ? (
                        <Stethoscope size={14} weight="bold" className="flex-shrink-0 text-blue-600" aria-hidden="true" />
                      ) : row.positive ? (
                        <ArrowCircleDown size={14} weight="fill" className="flex-shrink-0 text-emerald-600" aria-hidden="true" />
                      ) : (
                        <ArrowCircleUp size={14} weight="fill" className="flex-shrink-0 text-rose-600" aria-hidden="true" />
                      )}
                      <span className="truncate">{row.kindLabel}</span>
                    </div>
                    <div role="cell" className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-900">{row.label}</p>
                      {row.subLabel && <p className="truncate text-xs text-slate-500">{row.subLabel}</p>}
                    </div>
                    <div role="cell" className={`text-right text-sm font-bold tabular-nums ${row.positive ? 'text-emerald-700' : 'text-rose-700'}`}>
                      {row.positive ? '+' : '−'}
                      {formatVnd(row.amount)}
                    </div>
                    <div role="cell" className="text-center">
                      <StatusBadge tone={row.statusTone}>{row.statusLabel}</StatusBadge>
                    </div>
                  </button>
                ))}
              </div>
          </div>
        )}
      </div>

      {voucherDetailId && <CashVoucherDetailDialog voucherId={voucherDetailId} onClose={() => setVoucherDetailId(null)} />}
    </div>
  );
}
