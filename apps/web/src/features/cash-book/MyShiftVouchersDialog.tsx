import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowCircleDown, ArrowCircleUp, ClockCounterClockwise, Eye, Receipt, Stethoscope } from '@phosphor-icons/react';
import type { CashierShiftDetail } from '@nexamed/shared';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ModalHeader } from '../../shared/ui/ModalHeader';
import { RowActionButton } from '../../shared/ui/RowActionButton';
import { Skeleton } from '../../shared/ui/Skeleton';
import { StatusBadge, type StatusBadgeTone } from '../../shared/ui/StatusBadge';
import { formatVnd } from '../../shared/format/currency';
import { useCashierShiftInvoicePaymentsQuery } from '../cashier-shift/cashier-shift.queries';
import { CashVoucherDetailDialog } from './CashVoucherDetailDialog';
import { useCashVouchersQuery } from './cash-voucher.queries';

interface ActivityRow {
  id: string;
  timeIso: string;
  kind: 'invoice' | 'voucher';
  /** Chỉ có với `kind==='invoice'` — để bấm "Xem" mở đúng hoá đơn. */
  encounterId?: string;
  invoiceId?: string;
  kindLabel: string;
  label: string;
  subLabel: string;
  amount: number;
  positive: boolean;
  statusLabel: string;
  statusTone: StatusBadgeTone;
}

const GRID_COLUMNS = '70px 160px 2fr 140px 130px 70px';

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
 * Phần tiền khám lấy từ `GET /cashier-shifts/:id/invoice-payments` — từng SỰ KIỆN thu/hoàn tiền dựng từ
 * chính các dòng `payment` của ca (cùng nguồn với "Tổng kết hệ thống"/Sổ quỹ), nên hiện đúng cả thu
 * tiền hôm sau ngày tiếp nhận, hoàn tiền một phần (#203) và hoàn tiền nhiều ngày sau. (Trước #203 dựng
 * từ danh sách Thu ngân theo ngày tiếp nhận — sót các trường hợp đó, và phiếu hoàn hiện giờ THU sai.)
 * Phiếu thu/chi ngoài khám lọc thẳng theo `cashierShiftId` ở backend.
 */
export function MyShiftVouchersDialog({ shift, onClose }: { shift: CashierShiftDetail; onClose: () => void }) {
  const navigate = useNavigate();
  const [voucherDetailId, setVoucherDetailId] = useState<string | null>(null);

  const invoiceQuery = useCashierShiftInvoicePaymentsQuery(shift.id);
  const voucherQuery = useCashVouchersQuery({ cashierShiftId: shift.id });

  const rows: ActivityRow[] = useMemo(() => {
    const invoiceRows: ActivityRow[] = (invoiceQuery.data?.items ?? []).map((item) => {
      const isRefund = item.type === 'REFUND';
      return {
        id: `invoice-${item.invoiceId}-${item.type}-${item.paidAt}`,
        timeIso: item.paidAt,
        kind: 'invoice' as const,
        encounterId: item.encounterId,
        invoiceId: item.invoiceId,
        kindLabel: isRefund ? 'Hoàn tiền khám' : 'Thu tiền khám',
        label: item.fullName,
        subLabel: `${item.patientCode} · ${item.encounterNo} · ${item.invoiceNo}${isRefund && item.reason ? ` · ${item.reason}` : ''}`,
        amount: item.amount,
        positive: !isRefund,
        statusLabel: isRefund ? 'Đã hoàn tiền' : 'Đã thu',
        statusTone: isRefund ? ('accent' as const) : ('success' as const),
      };
    });

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
  }, [invoiceQuery.data, voucherQuery.data]);

  const isLoading = invoiceQuery.isPending || voucherQuery.isPending;

  function handleRowClick(row: ActivityRow) {
    if (row.kind === 'invoice' && row.encounterId) {
      navigate(`/billing/${row.encounterId}?invoiceId=${row.invoiceId}`);
      onClose();
    } else if (row.kind === 'voucher') {
      setVoucherDetailId(row.id.replace('voucher-', ''));
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4">
      <div className="flex max-h-[85vh] w-full max-w-6xl flex-col rounded-lg bg-white p-6 shadow-xl">
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
              <div style={{ minWidth: 900 }}>
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
                  <div role="columnheader" className="py-3 text-center">Thao tác</div>
                </div>

                {rows.map((row) => (
                  <div
                    key={row.id}
                    role="row"
                    style={{ gridTemplateColumns: GRID_COLUMNS }}
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
                    <div role="cell" className="flex items-center justify-center">
                      <RowActionButton icon={Eye} label="Xem" tone="neutral" onClick={() => handleRowClick(row)} />
                    </div>
                  </div>
                ))}
              </div>
          </div>
        )}
      </div>

      {voucherDetailId && <CashVoucherDetailDialog voucherId={voucherDetailId} onClose={() => setVoucherDetailId(null)} />}
    </div>
  );
}
