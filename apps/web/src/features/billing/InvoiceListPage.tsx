import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowCounterClockwise, Bank, CaretLeft, CaretRight, ClockCounterClockwise, Clock, LockKey, MagnifyingGlass, Receipt, Vault, Wallet, Warning } from '@phosphor-icons/react';
import type { BillingListItem, CashierShiftDetail } from '@nexamed/shared';
import { ApiError } from '../../shared/api/client';
import { useBreadcrumb } from '../../shared/layout/breadcrumb.context';
import { EmptyState } from '../../shared/ui/EmptyState';
import { ErrorBanner } from '../../shared/ui/ErrorBanner';
import { StatusBadge, type StatusBadgeTone } from '../../shared/ui/StatusBadge';
import { SelectionCheckbox } from '../../shared/ui/SelectionCheckbox';
import { SelectionToolbar } from '../../shared/ui/SelectionToolbar';
import { Skeleton } from '../../shared/ui/Skeleton';
import { formatVnd } from '../../shared/format/currency';
import { useRowSelection } from '../../shared/hooks/useRowSelection';
import { addDays, formatDateLabel, getVietnamTodayDateString } from '../appointment/schedule-grid.utils';
import { Button } from '../../shared/ui/Button';
import { CloseShiftDialog } from '../cashier-shift/CloseShiftDialog';
import { OpenShiftDialog } from '../cashier-shift/OpenShiftDialog';
import { useCurrentCashierShiftQuery } from '../cashier-shift/cashier-shift.queries';
import { useCashierShiftRequiredEnabledQuery } from '../clinic/clinic.queries';
import { useHasPermission } from '../auth/usePermission';
import { CashVoucherFormDialog, type CashVoucherSubmitDto } from '../cash-book/CashVoucherFormDialog';
import { MyShiftVouchersDialog } from '../cash-book/MyShiftVouchersDialog';
import { useCreateCashVoucherMutation } from '../cash-book/cash-voucher.queries';
import { useBillingInvoiceListQuery } from './invoice.queries';

/** Cùng khuôn `ReceptionListPage.tsx` (List Screen Pattern, .claude/docs/ui-guidelines.md mục 9).
 * Cột đầu (chọn dòng) để sẵn cho hành động hàng loạt sau này, chưa có hành động nào dùng tới. */
const GRID_COLUMNS = '40px 170px 1.4fr 190px 170px 150px 130px 130px 120px';
const TABLE_MIN_WIDTH_PX = 1300;
const ROW_HEIGHT_PX = 60;

type StatusTab = 'UNPAID' | 'PAID' | 'ALL';

/** #085 — nhãn/tone cho cả 4 trạng thái, dùng chung cho cột "Trạng thái" (nền đặc, #105). */
const STATUS_META: Record<BillingListItem['status'], { label: string; tone: StatusBadgeTone }> = {
  UNPAID: { label: 'Chờ thu', tone: 'warning' },
  PAID: { label: 'Đã thu', tone: 'success' },
  CANCELLED: { label: 'Đã huỷ (chưa thu)', tone: 'neutral' },
  REFUNDED: { label: 'Đã hoàn tiền', tone: 'accent' },
};

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  const vn = new Date(d.getTime() + 7 * 60 * 60_000);
  const dd = String(vn.getUTCDate()).padStart(2, '0');
  const mm = String(vn.getUTCMonth() + 1).padStart(2, '0');
  const hh = String(vn.getUTCHours()).padStart(2, '0');
  const min = String(vn.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${min} ${dd}/${mm}`;
}

function matchesSearch(item: BillingListItem, q: string): boolean {
  if (q === '') return true;
  const needle = q.trim().toLowerCase();
  return (
    item.invoiceNo.toLowerCase().includes(needle) ||
    item.encounterNo.toLowerCase().includes(needle) ||
    item.fullName.toLowerCase().includes(needle) ||
    item.patientCode.toLowerCase().includes(needle)
  );
}

/**
 * "Thu ngân" (Sprint 5/6, BIL-01→04) — danh sách phiếu thu trong ngày (tự động tạo lúc tiếp
 * nhận, xem `reception.service.ts`), đồng thời là màn tổng kết cuối ngày (thanh cố định phía
 * dưới). Mockup đã duyệt qua Artifact trước khi code (tham khảo bố cục MedPOS, phối lại theo
 * token/component sẵn có của NEXAMed).
 */
export function InvoiceListPage() {
  useBreadcrumb([{ label: 'Thu ngân' }]);
  const navigate = useNavigate();

  const [date, setDate] = useState(getVietnamTodayDateString());
  const [tab, setTab] = useState<StatusTab>('UNPAID');
  const [search, setSearch] = useState('');

  const listQuery = useBillingInvoiceListQuery(date);
  const allItems = listQuery.data?.items ?? [];
  const unpaidItems = allItems.filter((i) => i.status === 'UNPAID');
  const paidItems = allItems.filter((i) => i.status === 'PAID');
  const tabItems = tab === 'UNPAID' ? unpaidItems : tab === 'PAID' ? paidItems : allItems;
  const items = tabItems.filter((i) => matchesSearch(i, search));
  const itemIds = items.map((i) => i.invoiceId);
  const rowSelection = useRowSelection(itemIds);

  // Chụp lại đúng ca đang chốt tại thời điểm bấm nút — KHÔNG dùng lại `openShift` sống trong lúc
  // dialog mở: chốt ca thành công làm `openShift` về `null` ngay (query bị invalidate), nếu dialog
  // phụ thuộc `openShift` để render thì sẽ bị gỡ mất trước khi kịp hiện màn "Đã chốt ca thành
  // công" + phiếu in của chính nó — bug thật phát hiện lúc verify Playwright (docs/CURRENT.md).
  const [closingShift, setClosingShift] = useState<CashierShiftDetail | null>(null);
  const [openShiftDialogVisible, setOpenShiftDialogVisible] = useState(false);
  // "Yêu cầu mở ca trước khi thu tiền" (2026-09-04, đảo hướng cùng ngày sau khi thêm "Nhiều thu
  // ngân") — CHỈ còn quyết định "Thu tiền" có bị CHẶN khi chưa mở ca hay không (xem
  // `InvoiceDetailPage.handlePay()`), KHÔNG còn quyết định banner/nút "Mở ca"/"Chốt ca" ở trang
  // này có hiện hay không. Lý do đảo hướng: bản trước ẩn hẳn nút "Mở ca" theo công tắc này khiến
  // "Nhiều thu ngân cùng lúc" vô dụng khi bật cùng lúc với tắt công tắc này (không ai bấm mở ca
  // được ở đâu cả) — nay tách hẳn 2 mối quan tâm, chỉ đổi CÂU CHỮ banner theo `shiftRequired`
  // (bắt buộc/tuỳ chọn), không đổi việc HIỆN/ẨN.
  const shiftRequiredQuery = useCashierShiftRequiredEnabledQuery();
  const shiftRequired = shiftRequiredQuery.data?.enabled ?? true;
  const currentShiftQuery = useCurrentCashierShiftQuery();
  const openShift = currentShiftQuery.data?.openShift ?? null;
  // PERMISSION_DENIED nghĩa là vai trò này không có `cashier_shift.*` — không hiện gì thêm ở
  // Thu ngân, khác lỗi mạng thật (không chặn cả trang).
  const shiftFeatureUnavailable = currentShiftQuery.isError && currentShiftQuery.error instanceof ApiError && currentShiftQuery.error.code === 'PERMISSION_DENIED';

  // "Sổ quỹ & Thu chi" GĐ1 — nút tắt lập phiếu thu/chi NGOÀI dịch vụ khám ngay từ trang Thu ngân
  // (yêu cầu #5 mockup), tránh phải điều hướng sang mục sidebar riêng cho thao tác hay dùng.
  const canCreateCashVoucher = useHasPermission('cash_voucher', 'create');
  const [cashVoucherModalOpen, setCashVoucherModalOpen] = useState(false);
  const createCashVoucherMutation = useCreateCashVoucherMutation();
  // "Phiếu trong ca của tôi" (yêu cầu trực tiếp 2026-09-05) — xem lại thuần tuý (không tính tổng)
  // mọi phiếu (khám + ngoài khám) đã lập trong ca đang mở. Chỉ hiện khi có ca đang mở — xem lại
  // ca đã chốt không thuộc phạm vi yêu cầu này.
  const [myShiftVouchersOpen, setMyShiftVouchersOpen] = useState(false);

  async function handleCreateCashVoucher(dto: CashVoucherSubmitDto) {
    await createCashVoucherMutation.mutateAsync({
      direction: dto.direction!,
      incomeExpenseTypeCode: dto.incomeExpenseTypeCode,
      cashAccountId: dto.cashAccountId,
      paymentMethodCode: dto.paymentMethodCode,
      amount: dto.amount,
      occurredAt: dto.occurredAt,
      partnerName: dto.partnerName,
      description: dto.description,
      note: dto.note,
    });
  }

  return (
    <div className="flex h-full flex-col gap-2.5 p-3">
      <h1 className="sr-only">Thu ngân</h1>

      <div className="flex flex-shrink-0 flex-wrap items-center gap-2.5 px-1">
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setDate((d) => addDays(d, -1))}
            aria-label="Ngày trước"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-500 hover:bg-slate-50 hover:text-slate-900"
          >
            <CaretLeft size={15} weight="bold" />
          </button>
          <span className="min-w-[168px] rounded-md border border-slate-300 px-3.5 py-1.5 text-center text-[13.5px] font-semibold text-slate-900">
            {formatDateLabel(date)}
          </span>
          <button
            type="button"
            onClick={() => setDate((d) => addDays(d, 1))}
            aria-label="Ngày sau"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 text-slate-500 hover:bg-slate-50 hover:text-slate-900"
          >
            <CaretRight size={15} weight="bold" />
          </button>
          <button
            type="button"
            onClick={() => setDate(getVietnamTodayDateString())}
            className="rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-500 hover:bg-slate-50 hover:text-slate-900"
          >
            Hôm nay
          </button>
        </div>

        <div className="relative min-w-[220px] max-w-sm flex-1">
          <MagnifyingGlass size={15} weight="regular" aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm theo tên, mã bệnh nhân, mã phiếu thu..."
            className="w-full rounded-md border border-slate-300 py-1.5 pl-8 pr-3 text-sm text-slate-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20"
          />
        </div>

        {/* "Chốt ca" hiện bất cứ khi nào đang có ca mở, không phụ thuộc "Yêu cầu mở ca trước khi
            thu tiền" (đảo hướng 2026-09-04 — xem comment khai báo `shiftFeatureUnavailable`). */}
        {openShift && (
          <Button type="button" variant="amberSolid" onClick={() => setClosingShift(openShift)}>
            <LockKey size={16} weight="bold" aria-hidden="true" />
            Chốt ca
          </Button>
        )}
        {canCreateCashVoucher && (
          <Button type="button" variant="secondary" onClick={() => setCashVoucherModalOpen(true)}>
            <Vault size={16} weight="bold" aria-hidden="true" />
            Tạo phiếu thu/chi
          </Button>
        )}
        {openShift && (
          <Button type="button" variant="secondary" onClick={() => setMyShiftVouchersOpen(true)}>
            <ClockCounterClockwise size={16} weight="bold" aria-hidden="true" />
            Phiếu trong ca của tôi
          </Button>
        )}
      </div>

      {/* Chưa có ca mở — banner CHỦ ĐỘNG, nổi bật hơn hẳn nút "Mở ca" cũ (trước đặt lẫn trong
          thanh công cụ, cùng hàng ngày/tìm kiếm, chủ dự án phản hồi trực tiếp "không nổi bật,
          không gây chú ý" 2026-09-03) — full-width, tông xanh đặc (`bg-blue-600`, cùng token
          `primary` của Button) thay vì nút phụ nhỏ ở góc. LUÔN hiện khi chưa có ca (không còn phụ
          thuộc "Yêu cầu mở ca trước khi thu tiền", đảo hướng 2026-09-04) — chỉ câu mô tả đổi theo
          bắt buộc/tuỳ chọn, để "Nhiều thu ngân cùng lúc" vẫn dùng được khi công tắc kia đang tắt. */}
      {!openShift && !shiftFeatureUnavailable && (
        <div className="flex flex-shrink-0 items-center justify-between gap-3 rounded-xl bg-blue-600 px-5 py-3.5 text-white shadow-sm">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-white/20">
              <Wallet size={20} weight="bold" aria-hidden="true" />
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-bold">Chưa mở ca hôm nay</span>
              <span className="text-xs font-medium text-blue-100">
                {shiftRequired ? 'Cần mở ca trước khi thu tiền hoặc chốt ca.' : 'Mở ca nếu muốn đối soát tiền mặt theo ca (không bắt buộc).'}
              </span>
            </div>
          </div>
          <Button type="button" variant="secondary" onClick={() => setOpenShiftDialogVisible(true)}>
            Mở ca ngay
          </Button>
        </div>
      )}

      <div className="flex flex-shrink-0 items-center gap-1 border-b border-slate-200 px-1">
        {(
          [
            ['UNPAID', `Chờ thu (${unpaidItems.length})`],
            ['PAID', `Đã thu (${paidItems.length})`],
            ['ALL', `Tất cả (${allItems.length})`],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => setTab(value)}
            className={`-mb-px border-b-2 px-3.5 py-2 text-[13px] font-semibold ${
              tab === value ? 'border-blue-600 text-blue-700' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {listQuery.isPending && (
        <div className="min-h-0 flex-1 space-y-2 overflow-hidden rounded-lg bg-white p-4 shadow-sm">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      )}

      {listQuery.isError && (
        <ErrorBanner
          message={listQuery.error instanceof ApiError ? listQuery.error.message : 'Không tải được danh sách thu ngân.'}
          onRetry={() => void listQuery.refetch()}
        />
      )}

      {listQuery.isSuccess && items.length === 0 && (
        <EmptyState
          icon={Receipt}
          title="Không có phiếu thu nào"
          description="Phiếu thu tự động sinh khi tiếp nhận lượt khám có dịch vụ đã cấu hình đơn giá."
        />
      )}

      {listQuery.isSuccess && items.length > 0 && (
        <div className="min-h-0 flex-1 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div role="table" aria-label="Danh sách thu ngân" className="scroll-hover h-full overflow-x-auto">
            <div className="flex h-full flex-col" style={{ minWidth: TABLE_MIN_WIDTH_PX }}>
              <div
                role="row"
                style={{ gridTemplateColumns: GRID_COLUMNS }}
                className="grid flex-shrink-0 border-b-2 border-blue-600 bg-slate-100 px-4 text-xs font-bold uppercase tracking-wide text-slate-800"
              >
                <div role="columnheader" className="flex items-center justify-center py-2.5">
                  <SelectionCheckbox
                    checked={rowSelection.allLoadedSelected}
                    indeterminate={rowSelection.someLoadedSelected}
                    onChange={rowSelection.toggleAll}
                    ariaLabel="Chọn tất cả"
                  />
                </div>
                <div role="columnheader" className="py-2.5 text-center">Mã phiếu thu</div>
                <div role="columnheader" className="py-2.5 text-center">Bệnh nhân</div>
                <div role="columnheader" className="py-2.5 text-center">Lượt khám</div>
                <div role="columnheader" className="py-2.5 text-center">Khoa</div>
                <div role="columnheader" className="py-2.5 text-center">Tổng tiền</div>
                <div role="columnheader" className="py-2.5 text-center">Đã hoàn</div>
                <div role="columnheader" className="py-2.5 text-center">Trạng thái</div>
                <div role="columnheader" className="py-2.5 text-center">Thao tác</div>
              </div>

              <div className="scroll-hover flex-1 overflow-y-auto overflow-x-hidden">
                {items.map((item) => (
                  <div
                    key={item.invoiceId}
                    role="row"
                    style={{ gridTemplateColumns: GRID_COLUMNS, minHeight: ROW_HEIGHT_PX }}
                    className="grid items-center border-b border-slate-100 px-4 text-sm hover:bg-slate-50"
                  >
                    <div role="cell" className="flex items-center justify-center">
                      <SelectionCheckbox
                        checked={rowSelection.isSelected(item.invoiceId)}
                        onChange={() => rowSelection.toggle(item.invoiceId)}
                        ariaLabel={`Chọn ${item.fullName}`}
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => navigate(`/billing/${item.encounterId}`)}
                      role="cell"
                      className="truncate text-center font-medium text-blue-600 hover:text-blue-700"
                    >
                      {item.invoiceNo}
                    </button>
                    <div role="cell" className="min-w-0 text-left">
                      <div className="truncate font-semibold text-slate-900">{item.fullName}</div>
                      <div className="truncate text-xs text-slate-500">{item.patientCode}</div>
                    </div>
                    <div role="cell" className="min-w-0 text-center">
                      <div className="truncate font-medium text-slate-800">{item.encounterNo}</div>
                      <div className="truncate text-xs text-slate-500">{formatDateTime(item.checkedInAt)}</div>
                    </div>
                    <div role="cell" className="truncate text-center font-medium text-slate-600">{item.departmentName}</div>
                    <div role="cell" className="text-center font-bold tabular-nums text-slate-900">{formatVnd(item.totalAmount)}</div>
                    {/* Refund luôn TOÀN PHẦN (#085, không hoàn một phần) — số tiền đã hoàn của dòng
                        REFUNDED chính là `totalAmount` của dòng đó, không cần trường riêng. */}
                    <div role="cell" className="text-center font-bold tabular-nums text-violet-700">
                      {item.status === 'REFUNDED' ? `-${formatVnd(item.totalAmount)}` : <span className="text-slate-300">—</span>}
                    </div>
                    <div role="cell" className="flex flex-col items-center gap-1 text-center">
                      <StatusBadge tone={STATUS_META[item.status].tone}>{STATUS_META[item.status].label}</StatusBadge>
                      {/* #085 — phiếu PAID của lượt khám đã huỷ nhưng chưa hoàn tiền. */}
                      {item.needsRefund && (
                        <StatusBadge tone="danger">
                          <Warning size={10} weight="fill" aria-hidden="true" /> Cần hoàn tiền
                        </StatusBadge>
                      )}
                    </div>
                    <div role="cell" className="text-center">
                      <button
                        type="button"
                        onClick={() => navigate(`/billing/${item.encounterId}`)}
                        className={
                          item.status === 'UNPAID'
                            ? 'rounded-md bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-blue-700'
                            : 'rounded-md border border-slate-300 px-3 py-1.5 text-xs font-semibold text-slate-700 hover:bg-slate-50'
                        }
                      >
                        {item.status === 'UNPAID' ? 'Thu tiền' : 'Xem'}
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {listQuery.isSuccess && (
        <div className="flex flex-shrink-0 flex-wrap items-stretch overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex min-w-[190px] flex-1 items-center justify-center gap-3 px-5 py-3.5">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-600">
              <Wallet size={20} weight="bold" aria-hidden="true" />
            </div>
            <div className="flex flex-col">
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Đã thu hôm nay</span>
              <span className="text-xl font-bold tabular-nums text-slate-900">{formatVnd(listQuery.data.paidTotalAmount)}</span>
            </div>
          </div>
          {/* #085 — tách riêng "Đã hoàn"/"Thực thu" (paidTotalAmount VẪN gồm cả phiếu đã hoàn — xem
              computeDailyBillingTotals ở @nexamed/core — nên phải trừ ra ở đây mới đúng số tiền còn
              lại trong két, tránh chủ phòng khám đối soát bị lệch không giải thích được). Luôn hiện
              kể cả 0đ (2026-09-04, chủ dự án phản hồi trực tiếp) — ẩn theo điều kiện làm thanh tổng
              kết lệch xấu khi chỉ còn 2/3 khối. */}
          <div className="flex min-w-[190px] flex-1 items-center justify-center gap-3 border-l border-slate-100 px-5 py-3.5">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-violet-50 text-violet-600">
              <ArrowCounterClockwise size={20} weight="bold" aria-hidden="true" />
            </div>
            <div className="flex flex-col">
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Đã hoàn ({listQuery.data.refundedCount})</span>
              <span className="text-xl font-bold tabular-nums text-violet-700">
                {listQuery.data.refundedTotalAmount > 0 ? `-${formatVnd(listQuery.data.refundedTotalAmount)}` : formatVnd(0)}
              </span>
            </div>
          </div>
          {/* "Thực thu" (netTotalAmount = paidTotalAmount - refundedTotalAmount) — hiện lại theo yêu
              cầu trực tiếp 2026-09-04 (trước đó #111 từng ẩn để gọn, nay chủ dự án muốn xem lại số
              tiền thật còn trong két). */}
          <div className="flex min-w-[190px] flex-1 items-center justify-center gap-3 border-l border-slate-100 px-5 py-3.5">
            <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-blue-50 text-blue-600">
              <Bank size={20} weight="bold" aria-hidden="true" />
            </div>
            <div className="flex flex-col">
              <span className="text-[11px] font-bold uppercase tracking-wide text-slate-400">Thực thu</span>
              <span className="text-xl font-bold tabular-nums text-slate-900">{formatVnd(listQuery.data.netTotalAmount)}</span>
            </div>
          </div>
          {/* Cố ý tô nền đặc (khác các khối trên) — đây là mục CẦN HÀNH ĐỘNG (còn phiếu chưa thu),
              đúng token "Triage - Lưu ý/Đang chờ" (`bg-amber-500`, .claude/docs/ui-guidelines.md mục
              2.1). `flex-none` (khác 3 khối kia dùng `flex-1`) — chỉ rộng vừa đủ nội dung, không kéo
              giãn hết phần còn lại của thanh (chủ dự án phản hồi bản đầu "quá thô và to"). */}
          <div className="flex flex-none items-center gap-3 self-stretch bg-amber-500 px-5 py-3.5 text-white">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-white/20">
              <Clock size={18} weight="bold" aria-hidden="true" />
            </div>
            <div className="flex flex-col">
              <span className="text-[11px] font-bold uppercase tracking-wide text-amber-50">Còn chờ thu</span>
              <span className="whitespace-nowrap text-xl font-bold tabular-nums">
                {listQuery.data.unpaidCount} phiếu · {formatVnd(listQuery.data.unpaidTotalAmount)}
              </span>
            </div>
          </div>
        </div>
      )}

      <SelectionToolbar count={rowSelection.selectedCount} onClear={rowSelection.clear} />

      {/* "Chốt ca" — bắt buộc Mở ca trước khi dùng trang này nếu chưa có ca nào đang mở (mockup
          duyệt 2026-09-03). Không hiện gì nếu vai trò không có cashier_shift.* (bác sĩ/điều dưỡng). */}
      {openShiftDialogVisible && currentShiftQuery.isSuccess && !openShift && (
        <OpenShiftDialog
          previousClosedShift={currentShiftQuery.data.previousClosedShift}
          onCancel={() => setOpenShiftDialogVisible(false)}
          onSuccess={() => setOpenShiftDialogVisible(false)}
        />
      )}
      {closingShift && <CloseShiftDialog shift={closingShift} onClose={() => setClosingShift(null)} />}
      {cashVoucherModalOpen && (
        <CashVoucherFormDialog
          mode="create"
          submitting={createCashVoucherMutation.isPending}
          onCancel={() => setCashVoucherModalOpen(false)}
          onSubmit={handleCreateCashVoucher}
        />
      )}
      {myShiftVouchersOpen && openShift && <MyShiftVouchersDialog shift={openShift} onClose={() => setMyShiftVouchersOpen(false)} />}
    </div>
  );
}
